import {
  getTypescriptLibState,
  getTypescriptLibStateSlot,
  resetTypescriptLibState
} from '@mnaoumov/typescript-lib/typescript-lib-state';
import { ValueWrapper } from '@mnaoumov/typescript-lib/value-wrapper';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  getObsidianDevUtilsState,
  OBSIDIAN_LIB_GLOBAL_NAME,
  resetObsidianDevUtilsState,
  shareTypescriptLibStateWithObsidianDevUtilsState
} from './obsidian-dev-utils-state.ts';

interface GlobalThisWithState {
  __obsidianDevUtils: unknown;
  __obsidianLib: unknown;
}

describe('getObsidianDevUtilsState', () => {
  afterEach(() => {
    // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
    delete (globalThis as Partial<GlobalThisWithState>).__obsidianDevUtils;
  });

  it('should return a ValueWrapper with the default value when key is new', () => {
    const wrapper = getObsidianDevUtilsState('newKey', 'default');
    expect(wrapper.value).toBe('default');
  });

  it('should return the same ValueWrapper on second call with same key', () => {
    const first = getObsidianDevUtilsState('sameKey', 10);
    const second = getObsidianDevUtilsState('sameKey', 20);
    expect(second).toBe(first);
  });

  it('should return different ValueWrappers for different keys', () => {
    const a = getObsidianDevUtilsState('keyA', 1);
    const b = getObsidianDevUtilsState('keyB', 2);
    expect(a).not.toBe(b);
  });

  it('should store the shared state on globalThis', () => {
    const wrapper = getObsidianDevUtilsState('globalKey', 'gVal');
    expect(wrapper).toBeInstanceOf(ValueWrapper);
  });

  it('should allow the value to be modified through the wrapper', () => {
    const wrapper = getObsidianDevUtilsState('mutable', 'initial');
    wrapper.value = 'changed';
    const same = getObsidianDevUtilsState('mutable', 'initial');
    expect(same.value).toBe('changed');
  });

  it('should drop the shared state when reset', () => {
    const first = getObsidianDevUtilsState('resettable', 'a');
    resetObsidianDevUtilsState();
    const second = getObsidianDevUtilsState('resettable', 'b');
    expect(second).not.toBe(first);
    expect(second.value).toBe('b');
  });
});

describe('__obsidianLib', () => {
  afterEach(() => {
    resetObsidianDevUtilsState();
  });

  function getRealmGlobal(): Partial<GlobalThisWithState> {
    // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
    return globalThis as Partial<GlobalThisWithState>;
  }

  it('should be the same object as __obsidianDevUtils', () => {
    getObsidianDevUtilsState('aliasKey', 1);
    const realmGlobal = getRealmGlobal();
    expect(realmGlobal.__obsidianLib).toBe(realmGlobal.__obsidianDevUtils);
    expect(Object.keys(realmGlobal.__obsidianLib as object)).toContain('aliasKey');
  });

  it('should follow a bag an older copy put under __obsidianDevUtils', () => {
    getObsidianDevUtilsState('aliasKey', 1);
    const realmGlobal = getRealmGlobal();
    const olderCopyBag = {};
    realmGlobal.__obsidianDevUtils = olderCopyBag;
    expect(realmGlobal.__obsidianLib).toBe(olderCopyBag);
  });

  it('should write an assignment through to __obsidianDevUtils', () => {
    getObsidianDevUtilsState('aliasKey', 1);
    const realmGlobal = getRealmGlobal();
    const bag = {};
    realmGlobal.__obsidianLib = bag;
    expect(realmGlobal.__obsidianDevUtils).toBe(bag);
  });

  it('should keep an alias another copy already installed', () => {
    getObsidianDevUtilsState('aliasKey', 1);
    const descriptor = Object.getOwnPropertyDescriptor(getRealmGlobal(), OBSIDIAN_LIB_GLOBAL_NAME);
    getObsidianDevUtilsState('otherKey', 2);
    expect(Object.getOwnPropertyDescriptor(getRealmGlobal(), OBSIDIAN_LIB_GLOBAL_NAME)).toStrictEqual(descriptor);
  });
});

describe('shareTypescriptLibStateWithObsidianDevUtilsState', () => {
  afterEach(() => {
    resetObsidianDevUtilsState();
    resetTypescriptLibState();
  });

  it('should publish the generic wrappers under __obsidianDevUtils when an older copy left none there', () => {
    const sharedAbortController = getTypescriptLibState('sharedAbortController', 'controller');
    const debuggers = getTypescriptLibState('debuggers', 'debuggers');

    shareTypescriptLibStateWithObsidianDevUtilsState();

    expect(getObsidianDevUtilsState('sharedAbortController', 'other')).toBe(sharedAbortController);
    expect(getObsidianDevUtilsState('debuggers', 'other')).toBe(debuggers);
  });

  it('should adopt the wrappers an older copy already keeps under __obsidianDevUtils', () => {
    const legacyDebug = getObsidianDevUtilsState('debug', 'legacy');
    getTypescriptLibState('debug', 'modern');

    shareTypescriptLibStateWithObsidianDevUtilsState();

    expect(getTypescriptLibState('debug', 'other')).toBe(legacyDebug);
    expect(getObsidianDevUtilsState('debug', 'other')).toBe(legacyDebug);
  });

  it('should leave a key alone when neither side has it', () => {
    shareTypescriptLibStateWithObsidianDevUtilsState();

    expect(getTypescriptLibStateSlot().values).toStrictEqual({});
    expect(getObsidianDevUtilsState('debug', 'fresh').value).toBe('fresh');
  });

  it('should not link a key that stayed Obsidian-specific', () => {
    getTypescriptLibState('queue', 'generic');

    shareTypescriptLibStateWithObsidianDevUtilsState();

    expect(getObsidianDevUtilsState('queue', 'obsidian').value).toBe('obsidian');
  });
});
