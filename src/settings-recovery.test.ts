import type { App } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { IDBFactory } from 'fake-indexeddb';
import {
  describe,
  expect,
  it
} from 'vitest';

import { LocalDataStore } from './data-stores/local-data-store.ts';
import {
  DEFAULT_MAX_SETTINGS_RECOVERY_COPIES,
  isSettingsRecoveryCopy,
  LocalSettingsRecoveryStore,
  SETTINGS_RECOVERY_STORE_ID,
  SettingsRecoveryReason
} from './settings-recovery.ts';

interface CreateStoreParams {
  readonly factory?: IDBFactory;
  readonly maxCopies?: number;
  readonly times?: number[];
}

function createStore(params: CreateStoreParams = {}): LocalSettingsRecoveryStore {
  const times = params.times ?? [];
  let lastTime = 0;
  return new LocalSettingsRecoveryStore({
    app: castTo<App>({ appId: 'vault-id' }),
    factory: params.factory ?? new IDBFactory(),
    ...(params.maxCopies !== undefined && { maxCopies: params.maxCopies }),
    now: (): number => {
      lastTime = times.shift() ?? lastTime;
      return lastTime;
    },
    pluginId: 'foo'
  });
}

async function listTexts(store: LocalSettingsRecoveryStore): Promise<string[]> {
  const copies = await store.list();
  return copies.map((copy) => copy.rawText);
}

describe('LocalSettingsRecoveryStore', () => {
  it('should keep copies newest first, across connections', async () => {
    const factory = new IDBFactory();
    const store = createStore({ factory, times: [1000, 2000] });

    const first = await store.keep({ path: 'p/data.json', rawText: '{', reason: SettingsRecoveryReason.InvalidJson });
    const second = await store.keep({ path: 'p/data.json', rawText: '{"a":1}', reason: SettingsRecoveryReason.LossyRewrite });

    expect(first).toStrictEqual({
      id: new Date(1000).toISOString(),
      keptAt: 1000,
      path: 'p/data.json',
      rawText: '{',
      reason: SettingsRecoveryReason.InvalidJson
    });
    // Read back through structured clone, so the copies match by value, not by prototype.
    expect(await createStore({ factory }).list()).toEqual([second, first]);
  });

  it('should not duplicate a raw text it already keeps', async () => {
    const store = createStore({ times: [1000, 2000] });
    const first = await store.keep({ path: 'data.json', rawText: '{', reason: SettingsRecoveryReason.InvalidJson });
    const again = await store.keep({ path: 'data.json', rawText: '{', reason: SettingsRecoveryReason.InvalidJson });

    expect(again).toEqual(first);
    expect(await store.list()).toHaveLength(1);
  });

  it('should give copies kept in the same millisecond distinct ids', async () => {
    const store = createStore({ times: [1000, 1000, 1000] });
    const ids = [];
    for (const rawText of ['a', 'b', 'c']) {
      const copy = await store.keep({ path: 'data.json', rawText, reason: SettingsRecoveryReason.InvalidJson });
      ids.push(copy.id);
    }

    const base = new Date(1000).toISOString();
    expect(ids).toStrictEqual([base, `${base}-1`, `${base}-2`]);
    expect(await listTexts(store)).toStrictEqual(['c', 'b', 'a']);
  });

  it('should drop the oldest copies beyond the limit', async () => {
    const store = createStore({ maxCopies: 2, times: [1000, 2000, 3000] });
    for (const rawText of ['a', 'b', 'c']) {
      await store.keep({ path: 'data.json', rawText, reason: SettingsRecoveryReason.InvalidJson });
    }

    expect(await listTexts(store)).toStrictEqual(['c', 'b']);
  });

  it('should keep five copies by default', () => {
    expect(DEFAULT_MAX_SETTINGS_RECOVERY_COPIES).toBe(5);
  });

  it('should remove a copy', async () => {
    const store = createStore({ times: [1000, 2000] });
    const first = await store.keep({ path: 'data.json', rawText: 'a', reason: SettingsRecoveryReason.InvalidJson });
    await store.keep({ path: 'data.json', rawText: 'b', reason: SettingsRecoveryReason.InvalidJson });

    await store.remove(first.id);

    expect(await listTexts(store)).toStrictEqual(['b']);
  });

  it('should ignore records of another shape', async () => {
    const factory = new IDBFactory();
    const local = await LocalDataStore.open({ factory, pluginId: 'foo', storeId: SETTINGS_RECOVERY_STORE_ID, vaultId: 'vault-id' });
    await local.set('junk', { id: 'junk' });
    local.close();

    expect(await createStore({ factory }).list()).toStrictEqual([]);
  });

  it('should use the real clock by default', async () => {
    const store = new LocalSettingsRecoveryStore({ app: castTo<App>({ appId: 'vault-id' }), factory: new IDBFactory(), pluginId: 'foo' });
    const before = Date.now();
    const copy = await store.keep({ path: 'data.json', rawText: 'a', reason: SettingsRecoveryReason.InvalidJson });
    expect(copy.keptAt).toBeGreaterThanOrEqual(before);
  });

  it('should reject a limit below one or not an integer', () => {
    expect(() => createStore({ maxCopies: 0 })).toThrow(RangeError);
    expect(() => createStore({ maxCopies: 1.5 })).toThrow(RangeError);
  });
});

describe('isSettingsRecoveryCopy', () => {
  it('should accept only the full shape', () => {
    const copy = { id: 'x', keptAt: 1, path: 'p', rawText: 'r', reason: SettingsRecoveryReason.LossyRewrite };
    expect(isSettingsRecoveryCopy(copy)).toBe(true);
    expect(isSettingsRecoveryCopy({ ...copy, reason: 'other' })).toBe(false);
    expect(isSettingsRecoveryCopy({ ...copy, keptAt: '1' })).toBe(false);
    expect(isSettingsRecoveryCopy(null)).toBe(false);
    expect(isSettingsRecoveryCopy('copy')).toBe(false);
  });
});
