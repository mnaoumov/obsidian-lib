/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('shared data stores in Obsidian', () => {
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
