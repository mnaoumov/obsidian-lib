// @vitest-environment jsdom

import type {
  App as AppOriginal,
  EventRef
} from 'obsidian';
import type { Mock } from 'vitest';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BulkOperationCommit } from '../bulk-operation.ts';
import type { PluginNoticeComponent } from './plugin-notice-component.ts';

import { registerBulkOperationProgressListener } from '../bulk-operation-progress.ts';
import { BulkOperationCommitComponent } from './bulk-operation-commit-component.ts';

const mocks = vi.hoisted(() => ({
  ensureMetadataCacheReady: vi.fn(),
  flushQueue: vi.fn(),
  open: vi.fn(),
  platform: { isDesktopApp: true },
  selectItem: vi.fn(),
  waitForPendingLinkUpdates: vi.fn()
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  class FileSystemAdapter {
    public getBasePath(): string {
      return '/vault';
    }
  }
  return {
    ...actual,
    FileSystemAdapter,
    Platform: {
      ...actual.Platform,
      get isDesktopApp(): boolean {
        return mocks.platform.isDesktopApp;
      }
    }
  };
});

vi.mock('../desktop-bulk-operation-git.ts', () => ({
  BulkOperationGitRepo: { open: mocks.open }
}));
vi.mock('../file-manager.ts', () => ({ waitForPendingLinkUpdates: mocks.waitForPendingLinkUpdates }));
vi.mock('../metadata-cache.ts', () => ({ ensureMetadataCacheReady: mocks.ensureMetadataCacheReady }));
vi.mock('../queue.ts', () => ({ flushQueue: mocks.flushQueue }));
vi.mock('../modals/select-item.ts', () => ({ selectItem: mocks.selectItem }));

interface FakeRepo {
  readonly listBulkOperationCommits: ReturnType<typeof vi.fn>;
  readonly recoverStaleLock: ReturnType<typeof vi.fn>;
  readonly revertBulkOperationCommit: ReturnType<typeof vi.fn>;
  readonly runBulkOperation: ReturnType<typeof vi.fn>;
}

interface FakeRunBulkOperationParams {
  readonly operation: () => Promise<unknown>;
  readonly settle: () => Promise<void>;
}

interface FakeSelectItemParams {
  readonly items: BulkOperationCommit[];
  readonly itemTextFunction: (item: BulkOperationCommit) => string;
}

type VaultEventListener = () => void;

const commit1: BulkOperationCommit = { date: '2026-10-29T10:00:00Z', isInterrupted: false, operationId: 'OP1', sha: 'a'.repeat(40), subject: 'OP1: One' };
const commit2: BulkOperationCommit = { date: '2026-10-29T11:00:00Z', isInterrupted: false, operationId: 'OP2', sha: 'b'.repeat(40), subject: 'OP2: Two' };
const commit2Twin: BulkOperationCommit = { ...commit2, sha: 'c'.repeat(40) };

let isEnabled: boolean;
let repo: FakeRepo;
let showNotice: Mock<PluginNoticeComponent['showNotice']>;
let vaultListeners: Map<EventRef, VaultEventListener>;

function createApp(adapter: unknown): AppOriginal {
  return strictProxy<AppOriginal>({
    vault: strictProxy<AppOriginal['vault']>({
      adapter: castTo<AppOriginal['vault']['adapter']>(adapter),
      offref(eventRef: EventRef): void {
        vaultListeners.delete(eventRef);
      },
      on: castTo<AppOriginal['vault']['on']>((_name: string, listener: VaultEventListener): EventRef => {
        const eventRef = castTo<EventRef>({});
        vaultListeners.set(eventRef, listener);
        return eventRef;
      })
    })
  });
}

async function createComponent(adapter?: unknown, quietPeriodInMilliseconds = 20): Promise<BulkOperationCommitComponent> {
  const { FileSystemAdapter } = await import('obsidian');
  const component = new BulkOperationCommitComponent({
    app: createApp(adapter ?? new FileSystemAdapter()),
    isEnabled: (): boolean => isEnabled,
    maxSettleTimeInMilliseconds: 200,
    pluginId: 'my-plugin',
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
    quietPeriodInMilliseconds
  });
  return component;
}

function triggerVaultChange(): void {
  for (const listener of vaultListeners.values()) {
    listener();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  isEnabled = true;
  mocks.platform.isDesktopApp = true;
  vaultListeners = new Map();
  showNotice = vi.fn<PluginNoticeComponent['showNotice']>();
  repo = {
    listBulkOperationCommits: vi.fn().mockResolvedValue([commit2, commit1]),
    recoverStaleLock: vi.fn().mockResolvedValue(null),
    revertBulkOperationCommit: vi.fn().mockResolvedValue({ isConflict: false, output: '' }),
    runBulkOperation: vi.fn(async (params: FakeRunBulkOperationParams) => {
      const result = await params.operation();
      await params.settle();
      return { commitSha: 'sha', operationId: 'OP3', recoveredOperationId: null, result };
    })
  };
  mocks.open.mockResolvedValue(repo);
  mocks.flushQueue.mockResolvedValue(undefined);
  mocks.waitForPendingLinkUpdates.mockResolvedValue(undefined);
  mocks.ensureMetadataCacheReady.mockResolvedValue(undefined);
});

describe('BulkOperationCommitComponent', () => {
  it('should run the operation plainly while the setting is off', async () => {
    isEnabled = false;
    const component = await createComponent();
    expect(await component.runBulkOperation({ operation: () => 7, summary: 'Plain' })).toBe(7);
    expect(await component.checkActive()).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('should run the operation plainly with the default timings', async () => {
    isEnabled = false;
    const component = new BulkOperationCommitComponent({
      app: createApp({}),
      isEnabled: (): boolean => isEnabled,
      pluginId: 'my-plugin',
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice })
    });
    expect(await component.runBulkOperation({ operation: () => 'default', summary: 'Defaults' })).toBe('default');
  });

  it('should be inactive on mobile', async () => {
    mocks.platform.isDesktopApp = false;
    const component = await createComponent();
    expect(await component.checkActive()).toBe(false);
  });

  it('should be inactive for a vault not on the file system', async () => {
    const component = await createComponent({});
    expect(await component.checkActive()).toBe(false);
  });

  it('should be inactive outside a git work tree', async () => {
    mocks.open.mockResolvedValue(null);
    const component = await createComponent();
    expect(await component.runBulkOperation({ operation: () => 'plain', summary: 'No repo' })).toBe('plain');
    expect(mocks.open).toHaveBeenCalledWith('/vault');
  });

  it('should find the repository once', async () => {
    const component = await createComponent();
    expect(await component.checkActive()).toBe(true);
    expect(await component.checkActive()).toBe(true);
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  it('should wrap the operation and settle the vault before its commit', async () => {
    const component = await createComponent();
    const result = await component.runBulkOperation({ operation: () => Promise.resolve('wrapped'), summary: 'Wrapped' });
    expect(result).toBe('wrapped');
    expect(repo.runBulkOperation).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'my-plugin', summary: 'Wrapped' }));
    expect(mocks.flushQueue).toHaveBeenCalled();
    expect(mocks.waitForPendingLinkUpdates).toHaveBeenCalled();
    expect(mocks.ensureMetadataCacheReady).toHaveBeenCalled();
    expect(vaultListeners.size).toBe(0);
  });

  it('should log an operation that changed nothing', async () => {
    repo.runBulkOperation.mockResolvedValue({ commitSha: null, operationId: 'OP3', recoveredOperationId: null, result: 'none' });
    const component = await createComponent();
    expect(await component.runBulkOperation({ operation: () => 'none', summary: 'Nothing' })).toBe('none');
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should say so when the operation lock was recovered while it ran', async () => {
    repo.runBulkOperation.mockResolvedValue({ commitSha: 'sha', operationId: 'OP4', recoveredOperationId: 'OP3', result: 'split' });
    const component = await createComponent();
    expect(await component.runBulkOperation({ operation: () => 'split', summary: 'Split' })).toBe('split');
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('committed as OP3 interrupted, and the rest as OP4'));
  });

  it('should wait for the vault to go quiet after its last change, reporting progress meanwhile', async () => {
    let changedAt = 0;
    // The first progress report comes from inside the wait, once it listens for vault changes.
    const unregister = registerBulkOperationProgressListener(() => {
      if (changedAt !== 0) {
        return;
      }

      changedAt = performance.now();
      triggerVaultChange();
    });
    const component = await createComponent();
    await component.runBulkOperation({ operation: () => undefined, summary: 'Quiet' });
    const quietAt = performance.now();
    unregister();
    expect(changedAt).toBeGreaterThan(0);
    expect(quietAt - changedAt).toBeGreaterThanOrEqual(19);
  });
  it('should stop waiting for quiet at the settle deadline', async () => {
    // A quiet period longer than the deadline can never be met, so the deadline is what ends the wait, whatever
    // the machine load does to timers.
    const component = await createComponent(undefined, 10_000);
    const startedAt = performance.now();
    await component.runBulkOperation({ operation: () => undefined, summary: 'Busy vault' });
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(195);
    expect(elapsed).toBeLessThan(5000);
  });
  it('should recover a stale lock on load and say so', async () => {
    repo.recoverStaleLock.mockResolvedValue('OP9');
    const component = await createComponent();
    component.load();
    await waitForAllAsyncOperations();
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('OP9'));
  });

  it('should stay quiet on load without a stale lock', async () => {
    const component = await createComponent();
    component.load();
    await waitForAllAsyncOperations();
    expect(repo.recoverStaleLock).toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should skip recovery on load while inactive', async () => {
    isEnabled = false;
    const component = await createComponent();
    component.load();
    await waitForAllAsyncOperations();
    expect(repo.recoverStaleLock).not.toHaveBeenCalled();
  });

  describe('undoBulkOperation', () => {
    it('should say so while inactive', async () => {
      isEnabled = false;
      const component = await createComponent();
      await component.undoBulkOperation();
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('off'));
    });

    it('should say so when there is no operation', async () => {
      repo.listBulkOperationCommits.mockResolvedValue([]);
      const component = await createComponent();
      await component.undoBulkOperation();
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('No bulk operation'));
    });

    it('should let the user pick and revert the picked operation', async () => {
      mocks.selectItem.mockImplementation((params: FakeSelectItemParams) => {
        expect(params.items).toEqual([commit2, commit1]);
        expect(params.itemTextFunction(commit1)).toBe('OP1: One (2026-10-29T10:00:00Z, aaaaaaaa)');
        return Promise.resolve(commit1);
      });
      const component = await createComponent();
      await component.undoBulkOperation();
      expect(repo.revertBulkOperationCommit).toHaveBeenCalledWith(commit1);
      expect(showNotice).toHaveBeenCalledWith('Reverted OP1.');
    });

    it('should do nothing when the user cancels the pick', async () => {
      mocks.selectItem.mockResolvedValue(null);
      const component = await createComponent();
      await component.undoBulkOperation();
      expect(repo.revertBulkOperationCommit).not.toHaveBeenCalled();
    });

    it('should revert a named operation without asking', async () => {
      const component = await createComponent();
      await component.undoBulkOperation('OP1');
      expect(mocks.selectItem).not.toHaveBeenCalled();
      expect(repo.revertBulkOperationCommit).toHaveBeenCalledWith(commit1);
    });

    it('should ask which commit when a named operation id is ambiguous', async () => {
      repo.listBulkOperationCommits.mockResolvedValue([commit2Twin, commit2, commit1]);
      mocks.selectItem.mockImplementation((params: FakeSelectItemParams) => {
        expect(params.items).toEqual([commit2Twin, commit2]);
        return Promise.resolve(commit2);
      });
      const component = await createComponent();
      await component.undoBulkOperation('OP2');
      expect(repo.revertBulkOperationCommit).toHaveBeenCalledWith(commit2);
    });

    it('should say so when a named operation is not found', async () => {
      const component = await createComponent();
      await component.undoBulkOperation('OP7');
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('No bulk operation'));
    });

    it('should leave a conflict for the user', async () => {
      repo.revertBulkOperationCommit.mockResolvedValue({ isConflict: true, output: 'CONFLICT' });
      const component = await createComponent();
      await component.undoBulkOperation('OP1');
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('git revert --continue'), { isPermanent: true });
    });

    it('should report a revert that fails', async () => {
      repo.revertBulkOperationCommit.mockRejectedValue(new Error('locked'));
      const component = await createComponent();
      await component.undoBulkOperation('OP1');
      expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('Failed to revert OP1'));
    });
  });
});
