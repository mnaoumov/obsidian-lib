/**
 * @file
 *
 * Integration tests for the empty-folder helpers of `vault.ts` against a real Obsidian instance.
 *
 * `deleteEmptyFolder` removes the folder through `vault.delete` instead of the trash. The unit tests can only see
 * which call it makes, so this suite proves that the call really removes the folder on the real adapter, which is
 * where a non-forced `vault.delete` fails: the desktop adapter refuses every folder with `ERR_FS_EISDIR`.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface EmptyFolderResult {
  readonly doesHiddenChildSurvive: boolean;
  readonly doesNonEmptyFolderSurvive: boolean;
  readonly isEmptyFolderGone: boolean;
  readonly isHierarchyGone: boolean;
  readonly trashFileCallCount: number;
}

describe('deleteEmptyFolder', () => {
  it('should remove empty folders without the trash and keep a folder holding a hidden file', async () => {
    const result = await evalInObsidian<Record<string, never>, EmptyFolderResult>({
      async callback({ app, lib: { deleteEmptyFolder, deleteEmptyFolderHierarchy } }) {
        const adapter = app.vault.adapter;
        const rootPath = 'delete-empty-folder-integration';
        const emptyFolderPath = `${rootPath}/empty`;
        const nonEmptyFolderPath = `${rootPath}/hidden-child`;
        const hiddenChildPath = `${nonEmptyFolderPath}/.keep`;
        const hierarchyParentPath = `${rootPath}/parent`;
        const hierarchyChildPath = `${hierarchyParentPath}/child`;

        const originalTrashFile = app.fileManager.trashFile.bind(app.fileManager);
        let trashFileCallCount = 0;
        app.fileManager.trashFile = async (file): Promise<void> => {
          trashFileCallCount++;
          await originalTrashFile(file);
        };

        await app.vault.createFolder(rootPath);
        await app.vault.createFolder(emptyFolderPath);
        await app.vault.createFolder(nonEmptyFolderPath);
        await adapter.write(hiddenChildPath, 'HIDDEN');
        await app.vault.createFolder(hierarchyParentPath);
        await app.vault.createFolder(hierarchyChildPath);

        try {
          await deleteEmptyFolder(app, emptyFolderPath);
          await deleteEmptyFolder(app, nonEmptyFolderPath);
          // The hierarchy walk stops at the root, which still holds the folder with the hidden file.
          await deleteEmptyFolderHierarchy(app, hierarchyChildPath);

          return {
            doesHiddenChildSurvive: await adapter.exists(hiddenChildPath),
            doesNonEmptyFolderSurvive: await adapter.exists(nonEmptyFolderPath),
            isEmptyFolderGone: !await adapter.exists(emptyFolderPath),
            isHierarchyGone: !await adapter.exists(hierarchyParentPath),
            trashFileCallCount
          };
        } finally {
          // Not an assignment, which require-atomic-updates reads as racing the awaits above: nothing else patches it here.
          Object.assign(app.fileManager, { trashFile: originalTrashFile });
          await adapter.rmdir(rootPath, true);
        }
      }
    });

    expect(result.isEmptyFolderGone).toBe(true);
    expect(result.isHierarchyGone).toBe(true);
    expect(result.doesNonEmptyFolderSurvive).toBe(true);
    expect(result.doesHiddenChildSurvive).toBe(true);
    expect(result.trashFileCallCount).toBe(0);
  });
});
