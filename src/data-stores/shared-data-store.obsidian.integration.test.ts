/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('shared data stores in Obsidian', () => {
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
