import { ValueWrapper } from '@mnaoumov/typescript-lib/value-wrapper';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  getObsidianLibState,
  resetObsidianLibState
} from './obsidian-lib-state.ts';

interface GlobalThisWithState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test cleanup removes the realm shared-state bag.
  __obsidianLib: unknown;
}

describe('getObsidianLibState', () => {
  afterEach(() => {
    // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
    delete (globalThis as Partial<GlobalThisWithState>).__obsidianLib;
  });

  it('should return a ValueWrapper with the default value when key is new', () => {
    const wrapper = getObsidianLibState('newKey', 'default');
    expect(wrapper.value).toBe('default');
  });

  it('should return the same ValueWrapper on second call with same key', () => {
    const first = getObsidianLibState('sameKey', 10);
    const second = getObsidianLibState('sameKey', 20);
    expect(second).toBe(first);
  });

  it('should return different ValueWrappers for different keys', () => {
    const a = getObsidianLibState('keyA', 1);
    const b = getObsidianLibState('keyB', 2);
    expect(a).not.toBe(b);
  });

  it('should store the shared state on globalThis.__obsidianLib', () => {
    const wrapper = getObsidianLibState('globalKey', 'gVal');
    expect(wrapper).toBeInstanceOf(ValueWrapper);
    // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
    const bag = (globalThis as Partial<GlobalThisWithState>).__obsidianLib as Record<string, unknown>;
    expect(bag['globalKey']).toBe(wrapper);
  });

  it('should allow the value to be modified through the wrapper', () => {
    const wrapper = getObsidianLibState('mutable', 'initial');
    wrapper.value = 'changed';
    const same = getObsidianLibState('mutable', 'initial');
    expect(same.value).toBe('changed');
  });

  it('should replace an accessor an older copy installed with a bag of its own', () => {
    const olderCopyBag: Record<string, unknown> = {};
    // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
    Object.defineProperty(globalThis, '__obsidianLib', {
      configurable: true,
      get: () => olderCopyBag
    });

    const wrapper = getObsidianLibState('ownKey', 1);

    expect(olderCopyBag).toStrictEqual({});
    // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
    expect(Object.getOwnPropertyDescriptor(globalThis, '__obsidianLib')?.value).toStrictEqual({ ownKey: wrapper });
  });

  it('should drop the shared state when reset', () => {
    const first = getObsidianLibState('resettable', 'a');
    resetObsidianLibState();
    const second = getObsidianLibState('resettable', 'b');
    expect(second).not.toBe(first);
    expect(second.value).toBe('b');
  });
});
