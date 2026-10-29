import type { ExecException } from 'node:child_process';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import {
  hostname,
  tmpdir
} from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BulkOperationLock } from './bulk-operation.ts';

import { reportBulkOperationProgress } from './bulk-operation-progress.ts';
import {
  BulkOperationGitRepo,
  GitCommandError
} from './desktop-bulk-operation-git.ts';

type ExecFileCallback = (error: ExecException | null, stdout: string, stderr: string) => void;
type ExecFileOverride = (gitArguments: readonly string[], callback: ExecFileCallback) => boolean;

const { execFileOverrides, fsOverrides } = vi.hoisted(() => ({
  execFileOverrides: [] as ExecFileOverride[],
  fsOverrides: {
    unlink: null as ((path: string) => null | Promise<void>) | null,
    writeFile: null as ((path: string) => null | Promise<void>) | null
  }
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (file: string, gitArguments: string[], options: object, callback: ExecFileCallback): unknown => {
      for (const override of execFileOverrides) {
        if (override(gitArguments, callback)) {
          return undefined;
        }
      }
      return actual.execFile(file, gitArguments, options, callback);
    }
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async unlink(path: string): Promise<void> {
      await (fsOverrides.unlink?.(path) ?? actual.unlink(path));
    },
    async writeFile(path: string, data: string, options?: object): Promise<void> {
      await (fsOverrides.writeFile?.(path) ?? actual.writeFile(path, data, options));
    }
  };
});

// Every case drives the real git CLI several times, which is slow on Windows and under load.
vi.setConfig({ testTimeout: 60_000 });

const PLUGIN_ID = 'my-plugin';
const temporaryFolders: string[] = [];

interface TestRepo {
  readonly gitDirectory: string;
  readonly root: string;
}

function createLock(overrides: Partial<BulkOperationLock> = {}): BulkOperationLock {
  return {
    heartbeatAt: Date.now(),
    host: 'another-host',
    operationId: 'OP5',
    pluginId: 'other-plugin',
    processId: 1,
    processStartedAt: 0,
    startedAt: Date.now(),
    ...overrides
  };
}

function createRepo(): TestRepo {
  const root = mkdtempSync(join(tmpdir(), 'obsidian-lib-bulk-operation-'));
  temporaryFolders.push(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  const hooksPath = join(root, '.git', 'test-hooks');
  mkdirSync(hooksPath);
  for (
    const [key, value] of [
      ['user.name', 'Test'],
      ['user.email', 'test@example.com'],
      ['commit.gpgSign', 'false'],
      ['core.autocrlf', 'false'],
      ['core.hooksPath', hooksPath]
    ] as const
  ) {
    git(root, 'config', key, value);
  }
  return { gitDirectory: join(root, '.git'), root };
}

function git(cwd: string, ...gitArguments: string[]): string {
  return execFileSync('git', gitArguments, { cwd, encoding: 'utf-8' }).trim();
}

function lockPath(repo: TestRepo): string {
  return join(repo.gitDirectory, 'obsidian-bulk-operation.json');
}

function log(repo: TestRepo): string[] {
  return git(repo.root, 'log', '--all', '--format=%s').split('\n').filter(Boolean);
}

function openRepo(repo: TestRepo, workingDirectory = repo.root, lockWaitTimeoutInMilliseconds?: number): BulkOperationGitRepo {
  return new BulkOperationGitRepo({
    gitDirectory: repo.gitDirectory,
    workingDirectory,
    ...(lockWaitTimeoutInMilliseconds !== undefined && { lockWaitTimeoutInMilliseconds })
  });
}

function writeLock(repo: TestRepo, lock: BulkOperationLock): void {
  writeFileSync(lockPath(repo), JSON.stringify(lock));
}

beforeEach(() => {
  execFileOverrides.length = 0;
  fsOverrides.unlink = null;
  fsOverrides.writeFile = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { force: true, recursive: true });
  }
});

describe('BulkOperationGitRepo.open', () => {
  it('should find the repo of a folder inside a work tree', async () => {
    const repo = createRepo();
    mkdirSync(join(repo.root, 'vault'));
    const opened = await BulkOperationGitRepo.open(join(repo.root, 'vault'));
    expect(opened?.workingDirectory).toBe(join(repo.root, 'vault'));
    expect(opened?.gitDirectory.replaceAll('\\', '/').toLowerCase()).toBe(repo.gitDirectory.replaceAll('\\', '/').toLowerCase());
  });

  it('should return null outside a work tree', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'obsidian-lib-no-repo-'));
    temporaryFolders.push(folder);
    expect(await BulkOperationGitRepo.open(folder)).toBeNull();
  });

  it('should return null inside a git directory', async () => {
    const repo = createRepo();
    expect(await BulkOperationGitRepo.open(repo.gitDirectory)).toBeNull();
  });

  it('should return null when git cannot be run', async () => {
    execFileOverrides.push((_gitArguments, callback) => {
      callback(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) as ExecException, '', '');
      return true;
    });
    expect(await BulkOperationGitRepo.open(tmpdir())).toBeNull();
  });
});

describe('BulkOperationGitRepo.runBulkOperation', () => {
  it('should commit pending changes before the operation and the operation after it', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'pending.md'), 'pending');

    const result = await openRepo(repo).runBulkOperation({
      operation: () => {
        writeFileSync(join(repo.root, 'note.md'), 'changed');
        return Promise.resolve(42);
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Rewrite links'
    });

    expect(result.result).toBe(42);
    expect(result.operationId).toBe('OP1');
    expect(result.commitSha).toBe(git(repo.root, 'rev-parse', 'HEAD'));
    expect(log(repo)).toEqual(['OP1: Rewrite links', 'chore: before OP1']);
    expect(git(repo.root, 'show', '--name-only', '--format=', 'HEAD')).toBe('note.md');
    const body = git(repo.root, 'log', '-1', '--format=%b');
    expect(body).toContain('Changed-Files: 1');
    expect(body).toContain(`Obsidian-Plugin: ${PLUGIN_ID}`);
    expect(body).toContain('Obsidian-Bulk-Operation: OP1');
    expect(existsSync(lockPath(repo))).toBe(false);
  });

  it('should make no commit for an operation on a clean tree that changes nothing', async () => {
    const repo = createRepo();
    const result = await openRepo(repo).runBulkOperation({
      operation: () => Promise.resolve('done'),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Nothing'
    });
    expect(result).toEqual({ commitSha: null, operationId: 'OP1', result: 'done' });
    expect(log(repo)).toEqual([]);
  });

  it('should number operations past every id already in the history', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'a.md'), 'a');
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '--quiet', '-m', 'OP7: imported from another machine');

    const result = await openRepo(repo).runBulkOperation({
      operation: () => {
        writeFileSync(join(repo.root, 'a.md'), 'b');
        return noopAsync();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Next'
    });
    expect(result.operationId).toBe('OP8');
  });

  it('should commit the changes the settle step waits for', async () => {
    const repo = createRepo();
    await openRepo(repo).runBulkOperation({
      operation: () => noopAsync(),
      pluginId: PLUGIN_ID,
      settle: () => {
        writeFileSync(join(repo.root, 'follow-up.md'), 'follow-up');
        return noopAsync();
      },
      summary: 'Cascade'
    });
    expect(git(repo.root, 'show', '--name-only', '--format=', 'HEAD')).toBe('follow-up.md');
  });

  it('should commit a failed operation as interrupted and rethrow', async () => {
    const repo = createRepo();
    const error = new Error('boom');
    await expect(
      openRepo(repo).runBulkOperation({
        operation: () => {
          writeFileSync(join(repo.root, 'partial.md'), 'partial');
          return Promise.reject(error);
        },
        pluginId: PLUGIN_ID,
        settle: () => noopAsync(),
        summary: 'Fails'
      })
    ).rejects.toBe(error);
    expect(log(repo)).toEqual(['OP1 interrupted']);
    expect(existsSync(lockPath(repo))).toBe(false);
  });

  it('should commit only the vault folder when the vault is a subfolder of the repo', async () => {
    const repo = createRepo();
    const vault = join(repo.root, 'vault');
    mkdirSync(vault);
    writeFileSync(join(repo.root, 'outside.txt'), 'outside');
    writeFileSync(join(vault, 'pending.md'), 'pending');

    await openRepo(repo, vault).runBulkOperation({
      operation: () => {
        writeFileSync(join(vault, 'note.md'), 'note');
        return noopAsync();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Vault only'
    });

    expect(log(repo)).toEqual(['OP1: Vault only', 'chore: before OP1']);
    expect(git(repo.root, 'status', '--porcelain')).toBe('?? outside.txt');
  });

  it('should refresh the heartbeat from the operation progress', async () => {
    const repo = createRepo();
    let heartbeatBefore = 0;
    let heartbeatAfter = 0;
    await openRepo(repo).runBulkOperation({
      operation: async () => {
        heartbeatBefore = readLock(repo).heartbeatAt;
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
        reportBulkOperationProgress();
        reportBulkOperationProgress();
        await waitUntil(() => readLock(repo).heartbeatAt !== heartbeatBefore);
        heartbeatAfter = readLock(repo).heartbeatAt;
        vi.mocked(Date.now).mockRestore();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Heartbeat'
    });
    expect(heartbeatAfter - heartbeatBefore).toBeGreaterThanOrEqual(10_000);
  });

  it('should log a heartbeat that fails to write and carry on', async () => {
    const repo = createRepo();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    await openRepo(repo).runBulkOperation({
      operation: async () => {
        fsOverrides.writeFile = (): Promise<void> => Promise.reject(new Error('disk full'));
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
        reportBulkOperationProgress();
        await waitUntil(() => consoleErrorSpy.mock.calls.length > 0);
        vi.mocked(Date.now).mockRestore();
        fsOverrides.writeFile = null;
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Heartbeat failure'
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to refresh the bulk operation lock heartbeat', expect.any(Error));
  });

  it('should time out on a lock another live operation holds', async () => {
    const repo = createRepo();
    writeLock(repo, createLock());
    await expect(
      openRepo(repo, repo.root, 0).runBulkOperation({
        operation: () => noopAsync(),
        pluginId: PLUGIN_ID,
        settle: () => noopAsync(),
        summary: 'Blocked'
      })
    ).rejects.toThrow('Timed out waiting for OP5 of other-plugin on another-host');
    expect(existsSync(lockPath(repo))).toBe(true);
  });

  it('should name an unknown holder of a lock that has no operation id yet', async () => {
    const repo = createRepo();
    writeLock(repo, createLock({ operationId: '' }));
    await expect(
      openRepo(repo, repo.root, 0).runBulkOperation({
        operation: () => noopAsync(),
        pluginId: PLUGIN_ID,
        settle: () => noopAsync(),
        summary: 'Blocked'
      })
    ).rejects.toThrow('Timed out waiting for an operation of other-plugin');
  });

  it('should retry at once when the lock is released between creating and reading it', async () => {
    const repo = createRepo();
    let isFirstAttempt = true;
    fsOverrides.writeFile = (path): null | Promise<void> => {
      if (!isFirstAttempt || !path.endsWith('obsidian-bulk-operation.json')) {
        return null;
      }
      isFirstAttempt = false;
      return Promise.reject(Object.assign(new Error('exists'), { code: 'EEXIST' }));
    };
    const result = await openRepo(repo, repo.root, 0).runBulkOperation({
      operation: () => Promise.resolve('ran'),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Race'
    });
    expect(result.result).toBe('ran');
  });

  it('should wait for a held lock to be released', async () => {
    const repo = createRepo();
    writeLock(repo, createLock());
    window.setTimeout(() => {
      rmSync(lockPath(repo));
    }, 200);
    const result = await openRepo(repo).runBulkOperation({
      operation: () => Promise.resolve('ran'),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Waited'
    });
    expect(result.result).toBe('ran');
  });

  it('should recover a stale lock before running', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'leftover.md'), 'leftover');
    writeLock(repo, createLock({ heartbeatAt: 0 }));
    const result = await openRepo(repo).runBulkOperation({
      operation: () => {
        writeFileSync(join(repo.root, 'note.md'), 'note');
        return noopAsync();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'After recovery'
    });
    expect(result.operationId).toBe('OP6');
    expect(log(repo)).toEqual(['OP6: After recovery', 'OP5 interrupted']);
  });

  it('should retry a command that finds the index locked', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'note.md'), 'note');
    let isIndexLocked = true;
    execFileOverrides.push((gitArguments, callback) => {
      if (!isIndexLocked || gitArguments[0] !== 'add') {
        return false;
      }
      isIndexLocked = false;
      callback(Object.assign(new Error('failed'), { code: 128 }) as ExecException, '', 'fatal: Unable to create \'.git/index.lock\': File exists.');
      return true;
    });
    await openRepo(repo).runBulkOperation({
      operation: () => noopAsync(),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Retry'
    });
    expect(log(repo)).toEqual(['chore: before OP1']);
  });

  it('should throw a git failure and release the lock', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'note.md'), 'note');
    writeFileSync(join(repo.gitDirectory, 'test-hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const promise = openRepo(repo).runBulkOperation({
      operation: () => noopAsync(),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Hook fails'
    });
    await expect(promise).rejects.toBeInstanceOf(GitCommandError);
    expect(existsSync(lockPath(repo))).toBe(false);
  });

  it('should refuse a repo routed through git-annex when git-annex cannot be run', async () => {
    const repo = createRepo();
    git(repo.root, 'config', 'filter.annex.clean', 'git-annex smudge --clean -- %f');
    execFileOverrides.push((gitArguments, callback) => {
      if (gitArguments[0] !== 'annex') {
        return false;
      }
      callback(Object.assign(new Error('failed'), { code: 1 }) as ExecException, '', 'git: \'annex\' is not a git command.');
      return true;
    });
    await expect(
      openRepo(repo).runBulkOperation({
        operation: () => noopAsync(),
        pluginId: PLUGIN_ID,
        settle: () => noopAsync(),
        summary: 'Annex'
      })
    ).rejects.toThrow('git-annex is not on PATH');
  });

  it('should accept a repo routed through git-annex when git-annex runs', async () => {
    const repo = createRepo();
    git(repo.root, 'config', 'filter.annex.clean', 'git-annex smudge --clean -- %f');
    execFileOverrides.push((gitArguments, callback) => {
      if (gitArguments[0] !== 'annex') {
        return false;
      }
      callback(null, '10.0', '');
      return true;
    });
    const result = await openRepo(repo).runBulkOperation({
      operation: () => Promise.resolve('ok'),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Annex'
    });
    expect(result.result).toBe('ok');
  });
});

describe('BulkOperationGitRepo.recoverStaleLock', () => {
  it('should do nothing without a lock', async () => {
    const repo = createRepo();
    expect(await openRepo(repo).recoverStaleLock()).toBeNull();
  });

  it('should leave a fresh lock alone', async () => {
    const repo = createRepo();
    writeLock(repo, createLock());
    expect(await openRepo(repo).recoverStaleLock()).toBeNull();
    expect(existsSync(lockPath(repo))).toBe(true);
  });

  it('should commit the leftovers of a stale lock as interrupted and remove it', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'leftover.md'), 'leftover');
    writeLock(repo, createLock({ heartbeatAt: 0 }));
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP5');
    expect(log(repo)).toEqual(['OP5 interrupted']);
    expect(git(repo.root, 'log', '-1', '--format=%b')).toContain('Obsidian-Plugin: other-plugin');
    expect(existsSync(lockPath(repo))).toBe(false);
  });

  it('should allocate an id for a stale lock taken before its id was', async () => {
    const repo = createRepo();
    writeLock(repo, createLock({ heartbeatAt: 0, operationId: '', pluginId: '' }));
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP1');
  });

  it('should treat a lock of a dead process on this host as stale', async () => {
    const repo = createRepo();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    writeLock(repo, createLock({ host: hostname(), processId: 99_999 }));
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP5');
  });

  it.each([
    ['alive', (): true => true, true],
    ['not permitted to signal', (): never => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    }, true],
    ['unknown', (): never => {
      throw new Error('unknown');
    }, true]
  ])('should keep a lock of a process on this host that is %s', async (_name, kill, isKept) => {
    const repo = createRepo();
    vi.spyOn(process, 'kill').mockImplementation(kill);
    writeLock(repo, createLock({ host: hostname(), processId: 99_999 }));
    await openRepo(repo).recoverStaleLock();
    expect(existsSync(lockPath(repo))).toBe(isKept);
  });

  it('should treat a lock with no process id on this host as stale', async () => {
    const repo = createRepo();
    writeLock(repo, createLock({ host: hostname(), processId: 0 }));
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP5');
  });

  it('should judge an unreadable lock by its age', async () => {
    const repo = createRepo();
    writeFileSync(lockPath(repo), '{');
    expect(await openRepo(repo).recoverStaleLock()).toBeNull();
    utimesSync(lockPath(repo), 0, 0);
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP1');
  });

  it('should judge a lock of a foreign shape by its age', async () => {
    const repo = createRepo();
    writeFileSync(lockPath(repo), '{"owner":"someone"}');
    utimesSync(lockPath(repo), 0, 0);
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP1');
  });

  it('should tolerate a lock that vanishes during recovery', async () => {
    const repo = createRepo();
    writeLock(repo, createLock({ heartbeatAt: 0 }));
    fsOverrides.unlink = (): Promise<void> => Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    expect(await openRepo(repo).recoverStaleLock()).toBe('OP5');
  });

  it('should throw when a stale lock cannot be removed', async () => {
    const repo = createRepo();
    writeLock(repo, createLock({ heartbeatAt: 0 }));
    fsOverrides.unlink = (): Promise<void> => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    await expect(openRepo(repo).recoverStaleLock()).rejects.toThrow('busy');
  });

  it('should throw when the lock cannot be read', async () => {
    const repo = createRepo();
    mkdirSync(lockPath(repo));
    await expect(openRepo(repo).recoverStaleLock()).rejects.toThrow();
  });
});

describe('lock edge cases', () => {
  it('should throw when the lock cannot be created', async () => {
    const repo = createRepo();
    const missingGitDirectory = { gitDirectory: join(repo.root, 'missing'), root: repo.root };
    await expect(
      openRepo(missingGitDirectory).runBulkOperation({
        operation: () => noopAsync(),
        pluginId: PLUGIN_ID,
        settle: () => noopAsync(),
        summary: 'No git directory'
      })
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should leave a lock that another operation took over', async () => {
    const repo = createRepo();
    const foreignLock = createLock();
    await openRepo(repo).runBulkOperation({
      operation: () => {
        writeLock(repo, foreignLock);
        return noopAsync();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Taken over'
    });
    expect(readLock(repo)).toEqual(foreignLock);
  });

  it('should tolerate its own lock vanishing before release', async () => {
    const repo = createRepo();
    const result = await openRepo(repo).runBulkOperation({
      operation: () => {
        rmSync(lockPath(repo));
        return Promise.resolve('ok');
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Vanished'
    });
    expect(result.result).toBe('ok');
  });

  it('should tolerate its own lock vanishing during release', async () => {
    const repo = createRepo();
    fsOverrides.unlink = (path): null | Promise<void> => path.endsWith('obsidian-bulk-operation.json') ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })) : null;
    const result = await openRepo(repo).runBulkOperation({
      operation: () => Promise.resolve('ok'),
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Release race'
    });
    expect(result.result).toBe('ok');
  });

  it('should throw when its own lock cannot be removed', async () => {
    const repo = createRepo();
    fsOverrides.unlink = (path): null | Promise<void> => path.endsWith('obsidian-bulk-operation.json') ? Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) : null;
    await expect(
      openRepo(repo).runBulkOperation({
        operation: () => noopAsync(),
        pluginId: PLUGIN_ID,
        settle: () => noopAsync(),
        summary: 'Release fails'
      })
    ).rejects.toThrow('busy');
  });
});

describe('BulkOperationGitRepo.listBulkOperationCommits', () => {
  it('should list the plugin operations newest first', async () => {
    const repo = createRepo();
    const repoHandle = openRepo(repo);
    for (const [pluginId, fileName] of [[PLUGIN_ID, 'a.md'], ['other-plugin', 'b.md'], [PLUGIN_ID, 'c.md']] as const) {
      await repoHandle.runBulkOperation({
        operation: () => {
          writeFileSync(join(repo.root, fileName), fileName);
          return noopAsync();
        },
        pluginId,
        settle: () => noopAsync(),
        summary: `Write ${fileName}`
      });
    }

    const commits = await repoHandle.listBulkOperationCommits(PLUGIN_ID);
    expect(commits.map((commit) => commit.subject)).toEqual(['OP3: Write c.md', 'OP1: Write a.md']);
    expect(commits[0]?.sha).toBe(git(repo.root, 'rev-parse', 'HEAD'));
    expect(commits[0]?.isInterrupted).toBe(false);
  });

  it('should return nothing in a repo without commits', async () => {
    const repo = createRepo();
    expect(await openRepo(repo).listBulkOperationCommits(PLUGIN_ID)).toEqual([]);
  });

  it('should skip a commit that only mentions the plugin trailer', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'a.md'), 'a');
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '--quiet', '-m', 'docs: note', '-m', `Obsidian-Plugin: ${PLUGIN_ID}`);
    expect(await openRepo(repo).listBulkOperationCommits(PLUGIN_ID)).toEqual([]);
  });
});

describe('BulkOperationGitRepo.revertBulkOperationCommit', () => {
  it('should revert an operation after committing what is pending', async () => {
    const repo = createRepo();
    const repoHandle = openRepo(repo);
    await repoHandle.runBulkOperation({
      operation: () => {
        writeFileSync(join(repo.root, 'note.md'), 'changed');
        return noopAsync();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Change'
    });
    writeFileSync(join(repo.root, 'other.md'), 'pending');
    const [commit] = await repoHandle.listBulkOperationCommits(PLUGIN_ID);

    const result = await repoHandle.revertBulkOperationCommit(ensure(commit));

    expect(result.isConflict).toBe(false);
    expect(existsSync(join(repo.root, 'note.md'))).toBe(false);
    expect(log(repo)[0]).toBe('Revert "OP1: Change"');
    expect(log(repo)[1]).toBe('chore: before revert of OP1');
    expect(existsSync(lockPath(repo))).toBe(false);
  });

  it('should leave a conflicting revert for the user', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, 'note.md'), 'one');
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '--quiet', '-m', 'initial');
    const repoHandle = openRepo(repo);
    await repoHandle.runBulkOperation({
      operation: () => {
        writeFileSync(join(repo.root, 'note.md'), 'two');
        return noopAsync();
      },
      pluginId: PLUGIN_ID,
      settle: () => noopAsync(),
      summary: 'Change'
    });
    writeFileSync(join(repo.root, 'note.md'), 'three');
    const [commit] = await repoHandle.listBulkOperationCommits(PLUGIN_ID);

    const result = await repoHandle.revertBulkOperationCommit(ensure(commit));

    expect(result.isConflict).toBe(true);
    expect(result.output).toContain('note.md');
    expect(existsSync(join(repo.gitDirectory, 'REVERT_HEAD'))).toBe(true);
    expect(existsSync(lockPath(repo))).toBe(false);
  });
});

function ensure<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Value is undefined');
  }
  return value;
}

function readLock(repo: TestRepo): BulkOperationLock {
  return JSON.parse(readFileSync(lockPath(repo), 'utf-8')) as BulkOperationLock;
}

async function waitUntil(isDone: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!isDone()) {
    if (performance.now() > deadline) {
      throw new Error('Timed out');
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 10);
    });
  }
}
