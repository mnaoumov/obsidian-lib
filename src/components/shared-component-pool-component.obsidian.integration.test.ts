/**
 * @file
 *
 * Integration test for {@link SharedComponentPoolComponent} in a real Obsidian: one vault watcher is shared by two
 * real workspace panels, survives the first panel closing, and is removed once the last one closes.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface SharedWatcherResult {
  readonly countAfterFirstClose: number;
  readonly countAfterLastClose: number;
  readonly countWithBothOpen: number;
  readonly createdCount: number;
  readonly isSameWatcher: boolean;
  readonly unloadCountAfterFirstClose: number;
  readonly unloadCountAfterLastClose: number;
}

describe('SharedComponentPoolComponent', () => {
  it('should keep one watcher alive while any panel uses it and remove it after the last panel closes', async () => {
    const result = await evalInObsidian<Record<string, never>, SharedWatcherResult>({
      async callback({ app, lib: { SharedComponentPoolComponent, waitUntil }, obsidianModule: { Component, TFile } }): Promise<SharedWatcherResult> {
        const path = 'shared-component-pool-watched.md';
        const existing = app.vault.getAbstractFileByPath(path);
        const file = existing instanceof TFile ? existing : await app.vault.create(path, 'initial');

        let createdCount = 0;
        let modifyCount = 0;
        let unloadCount = 0;

        class NoteWatcherComponent extends Component {
          public constructor(private readonly watchedPath: string) {
            super();
          }

          public override onload(): void {
            this.registerEvent(app.vault.on('modify', (modifiedFile) => {
              if (modifiedFile.path === this.watchedPath) {
                modifyCount++;
              }
            }));
          }

          public override onunload(): void {
            unloadCount++;
          }
        }

        const owner = new Component();
        const pool = owner.addChild(
          new SharedComponentPoolComponent<string, NoteWatcherComponent>({
            createComponent: (watchedPath: string): NoteWatcherComponent => {
              createdCount++;
              return new NoteWatcherComponent(watchedPath);
            }
          })
        );
        owner.load();

        const leaf1 = app.workspace.getLeaf('split');
        const leaf2 = app.workspace.getLeaf('split');

        async function modifyAndCount(expectedCount: number): Promise<number> {
          await app.vault.modify(file, `changed ${String(Date.now())} ${String(Math.random())}`);
          if (expectedCount > modifyCount) {
            await waitUntil({
              message: `the watcher counts ${String(expectedCount)} modification(s)`,
              predicate: () => modifyCount >= expectedCount,
              timeoutInMilliseconds: 3000
            });
          }
          return modifyCount;
        }

        try {
          const acquisition1 = await pool.acquire(path, { consumer: leaf1.view });
          const acquisition2 = await pool.acquire(path, { consumer: leaf2.view });

          const countWithBothOpen = await modifyAndCount(1);

          leaf1.detach();
          const countAfterFirstClose = await modifyAndCount(2);
          const unloadCountAfterFirstClose = unloadCount;

          leaf2.detach();
          await app.vault.modify(file, 'after the last panel closed');
          const countAfterLastClose = modifyCount;

          return {
            countAfterFirstClose,
            countAfterLastClose,
            countWithBothOpen,
            createdCount,
            isSameWatcher: acquisition1.component === acquisition2.component,
            unloadCountAfterFirstClose,
            unloadCountAfterLastClose: unloadCount
          };
        } finally {
          leaf1.detach();
          leaf2.detach();
          owner.unload();
          await app.fileManager.trashFile(file);
        }
      }
    });

    expect(result).toEqual({
      countAfterFirstClose: 2,
      countAfterLastClose: 2,
      countWithBothOpen: 1,
      createdCount: 1,
      isSameWatcher: true,
      unloadCountAfterFirstClose: 0,
      unloadCountAfterLastClose: 1
    });
  });
});
