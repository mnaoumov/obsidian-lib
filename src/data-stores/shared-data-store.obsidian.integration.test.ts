/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('shared data stores in Obsidian', () => {
  it('enables local history as JSON and relocates it through the real adapter', async ({ annotate }) => {
    const result = await evalInObsidian({
      async callback({ app, lib: { LocalDataStore, SharedDataStore } }) {
        const storeId = `integration-${window.crypto.randomUUID()}`;
        const params = { pluginId: 'obsidian-lib-test', storeId, vaultId: app.appId };
        const local = await LocalDataStore.open(params);
        const otherLocal = await LocalDataStore.open({ ...params, vaultId: `${app.appId}-other` });
        const anchor = `Plugin data/${params.pluginId}/${storeId}`;
        const moved = `.plugin-data/${params.pluginId}/${storeId}`;
        const shared = { adapter: app.vault.adapter, format: 'json' as const, kind: 'last-write-wins' as const, pluginId: params.pluginId, storeId };
        try {
          const first = await SharedDataStore.open({ ...shared, isSyncEnabled: false, local });
          const started = performance.now();
          await first.setMany(Array.from({ length: 1000 }, (_, index) => [`key-${String(index)}`, { originalPath: `old-${String(index)}.png`, time: index }]));
          await first.set('deleted', 1);
          await first.delete('deleted');
          await first.compact();
          const localMilliseconds = performance.now() - started;
          const isHadLocalFolder = await app.vault.adapter.exists(anchor);
          const enableStarted = performance.now();
          await first.setSyncEnabled(true);
          const enableMilliseconds = performance.now() - enableStarted;
          const reopenStarted = performance.now();
          const second = await SharedDataStore.open({ ...shared, local: otherLocal });
          const bootstrapMilliseconds = performance.now() - reopenStarted;
          await first.relocate({ folder: '.plugin-data', format: 'json' });
          await second.synchronize();
          await second.set('after-move', 2);
          const reopened = await SharedDataStore.open({ ...shared, local });
          await reopened.setSyncEnabled(false);
          const disabled = await SharedDataStore.open({ ...shared, isSyncEnabled: false, local });
          const files: string[] = [];
          const pending = [...reopened.transportRoots];
          while (pending.length > 0) {
            const path = pending.pop();
            if (path === undefined) {
              throw new Error('Expected pending folder');
            }
            const children = await app.vault.adapter.list(path);
            files.push(...children.files);
            pending.push(...children.folders);
          }
          return {
            afterMove: reopened.get('after-move'),
            bootstrapMilliseconds,
            count: reopened.entries().length,
            deleted: reopened.get('deleted') === undefined,
            disabledRoots: disabled.transportRoots.length,
            enableMilliseconds,
            hadLocalFolder: isHadLocalFolder,
            isJson: files.every((path) => path.endsWith('.json')),
            localMilliseconds,
            roots: reopened.transportRoots.length
          };
        } finally {
          local.close();
          otherLocal.close();
          for (const root of [anchor, moved]) {
            if (await app.vault.adapter.exists(root)) {
              await app.vault.adapter.rmdir(root, true);
            }
          }
        }
      }
    });
    expect(result.hadLocalFolder).toBe(false);
    expect(result.isJson).toBe(true);
    expect(result.count).toBe(1001);
    expect(result.deleted).toBe(true);
    expect(result.afterMove).toBe(2);
    expect(result.roots).toBe(2);
    expect(result.disabledRoots).toBe(2);
    expect(result.localMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.enableMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.bootstrapMilliseconds).toBeGreaterThanOrEqual(0);
    await annotate(JSON.stringify({ bootstrapMilliseconds: result.bootstrapMilliseconds, enableMilliseconds: result.enableMilliseconds, localMilliseconds: result.localMilliseconds }), 'measurement');
  });

  it.each(['.plugin-data', 'plugin-config'])('round trips hidden storage through the real adapter in %s', async (location) => {
    const result = await evalInObsidian({
      async callback({ app, folderType, lib: { DataStoreTransport, LocalDataStore, SharedDataStore } }) {
        const folder = folderType === 'plugin-config' ? `${app.vault.configDir}/plugins/obsidian-lib-test/shared-data` : folderType;
        const storeId = `integration-${window.crypto.randomUUID()}`;
        const params = { pluginId: 'obsidian-lib-test', storeId, vaultId: app.appId };
        const local = await LocalDataStore.open(params);
        const freshLocal = await LocalDataStore.open({ ...params, vaultId: `${app.appId}-new-device` });
        const shared = { adapter: app.vault.adapter, folder, kind: 'last-write-wins' as const, pluginId: params.pluginId, storeId };
        const transport = new DataStoreTransport(shared);
        try {
          const first = await SharedDataStore.open({ ...shared, local });
          await first.set('key', 'value');
          const reopened = await SharedDataStore.open({ ...shared, local });
          const fresh = await SharedDataStore.open({ ...shared, local: freshLocal });
          await fresh.set('other', 2);
          await reopened.synchronize();
          const files = await transport.list();
          const logPath = files.find((path) => path.endsWith('/log-1.md'));
          return {
            files,
            folder,
            indexed: files.some((path) => app.vault.getAbstractFileByPath(path) !== null),
            readable: logPath !== undefined && (await transport.read(logPath)) !== undefined,
            reopened: reopened.entries()
          };
        } finally {
          local.close();
          freshLocal.close();
          await app.vault.adapter.rmdir(transport.root, true);
        }
      },
      input: { folderType: location }
    });
    expect(result.reopened).toEqual([['key', 'value'], ['other', 2]]);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.every((path) => path.startsWith(`${result.folder}/obsidian-lib-test/`))).toBe(true);
    expect(result.readable).toBe(true);
    expect(result.indexed).toBe(false);
  });

  it('serializes two connections through real Web Locks and bootstraps from real vault snapshots', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { LocalDataStore, SharedDataStore } }) {
        const storeId = `integration-${window.crypto.randomUUID()}`;
        const params = { pluginId: 'obsidian-lib-test', storeId, vaultId: app.appId };
        const firstLocal = await LocalDataStore.open(params);
        const secondLocal = await LocalDataStore.open(params);
        const thirdLocal = await LocalDataStore.open({ ...params, vaultId: `${app.appId}-new-device` });
        try {
          const shared = { adapter: app.vault.adapter, kind: 'last-write-wins' as const, pluginId: params.pluginId, storeId };
          const first = await SharedDataStore.open({ ...shared, local: firstLocal });
          const second = await SharedDataStore.open({ ...shared, local: secondLocal });
          await Promise.all([first.set('first', 1), second.set('second', 2)]);
          await first.synchronize();
          await second.synchronize();
          await first.compact();
          const third = await SharedDataStore.open({ ...shared, local: thirdLocal });
          return { first: first.entries(), second: second.entries(), third: third.entries() };
        } finally {
          firstLocal.close();
          secondLocal.close();
          thirdLocal.close();
          await app.vault.adapter.rmdir(`Plugin data/${params.pluginId}/${storeId}`, true);
        }
      }
    });
    expect(result.first).toEqual([['first', 1], ['second', 2]]);
    expect(result.second).toEqual(result.first);
    expect(result.third).toEqual(result.first);
  });
});
