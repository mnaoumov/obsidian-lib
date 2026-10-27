import {
  describe,
  expect,
  it
} from 'vitest';

import {
  DataStoreReplica,
  isDataStoreJsonValue,
  isDataStoreOperation
} from './data-store-replica.ts';

describe('DataStoreReplica', () => {
  it('rejects non-JSON, malformed clocks, invalid set tags and invalid register operations', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const value of [undefined, Infinity, NaN, new Date(), new Map(), cycle, [undefined], { value: undefined }]) {
      expect(isDataStoreJsonValue(value)).toBe(false);
    }
    expect(isDataStoreJsonValue({ nested: [true, false, null, 'text', 1] })).toBe(true);
    expect(isDataStoreOperation(null)).toBe(false);
    const operation = { counter: 0, deleted: false, device: 'A', key: 'key', sequence: 1, time: 1, value: 1 };
    expect(isDataStoreOperation({ ...operation, tags: [1] })).toBe(false);
    expect(() => {
      new DataStoreReplica('minimum').apply({ ...operation, value: 'invalid' });
    }).toThrow('finite numbers');
    expect(() => {
      new DataStoreReplica('maximum').apply({ ...operation, deleted: true });
    }).toThrow('deletion');
    expect(() => {
      new DataStoreReplica('last-write-wins').apply({ ...operation, sequence: 0 });
    }).toThrow('Invalid');
    expect(() => {
      new DataStoreReplica('observed-remove-set').apply(operation);
    }).toThrow('true');
    expect(() => {
      new DataStoreReplica('observed-remove-set').apply({ ...operation, deleted: true, tags: ['bad'] });
    }).toThrow('tag');
    const set = new DataStoreReplica('observed-remove-set');
    set.apply({ ...operation, deleted: true });
    set.apply({ ...operation, deleted: false, sequence: 3, value: true });
    set.apply({ ...operation, deleted: false, sequence: 1, value: true });
    expect(set.entries()).toEqual([['key', true]]);
    expect(set.get('key')).toBe(true);
    expect(set.get('missing')).toBeUndefined();
  });
  it('converges despite reordered and duplicate concurrent register operations', () => {
    const first = new DataStoreReplica('last-write-wins');
    const second = new DataStoreReplica('last-write-wins');
    const operations = [
      { counter: 0, deleted: false, device: 'A', key: 'key', sequence: 1, time: 100, value: 'A' },
      { counter: 0, deleted: false, device: 'B', key: 'key', sequence: 1, time: 100, value: 'B' },
      { counter: 1, deleted: true, device: 'A', key: 'key', sequence: 2, time: 100, value: null }
    ];
    for (const operation of operations) {
      first.apply(operation);
    }
    for (const operation of [...operations].reverse()) {
      second.apply(operation);
      second.apply(operation);
    }
    expect(second.export()).toEqual(first.export());
    expect(second.entries()).toEqual([]);
    expect(second.get('key')).toBeUndefined();
    expect(second.get('missing')).toBeUndefined();
  });

  it('merges min and max registers in either order', () => {
    for (const [kind, expected] of [['minimum', 1], ['maximum', 8]] as const) {
      const replica = new DataStoreReplica(kind);
      for (const value of [3, 8, 1, 3]) {
        replica.apply({ counter: 0, deleted: false, device: 'A', key: 'key', sequence: value, time: value, value });
      }
      expect(replica.entries()).toEqual([['key', expected]]);
    }
  });

  it('keeps a payload with its winning numeric rank', () => {
    const replica = new DataStoreReplica('minimum');
    replica.apply({ counter: 0, deleted: false, device: 'A', key: 'attachment', sequence: 1, time: 1, value: { rank: 20, value: 'later.pdf' } });
    replica.apply({ counter: 0, deleted: false, device: 'B', key: 'attachment', sequence: 1, time: 1, value: { rank: 10, value: 'original.pdf' } });
    expect(replica.entries()).toEqual([['attachment', { rank: 10, value: 'original.pdf' }]]);
    expect(replica.get('attachment')).toEqual({ rank: 10, value: 'original.pdf' });
  });

  it('keeps concurrent unseen set additions and compacts repeated add/remove history', () => {
    const first = new DataStoreReplica('observed-remove-set');
    const second = new DataStoreReplica('observed-remove-set');
    const operations = [
      { counter: 0, deleted: false, device: 'A', key: 'item', sequence: 1, time: 1, value: true },
      { counter: 0, deleted: true, device: 'A', key: 'item', sequence: 2, tags: ['A:1'], time: 2, value: null },
      { counter: 0, deleted: false, device: 'B', key: 'item', sequence: 1, time: 1, value: true }
    ];
    for (const operation of operations) {
      first.apply(operation);
    }
    for (const operation of [...operations].reverse()) {
      second.apply(operation);
    }
    expect(first.entries()).toEqual([['item', true]]);
    expect(first.export()).toEqual(second.export());
    expect(first.observedTags('item')).toContain('B:1');
    for (let sequence = 3; sequence < 100; sequence += 2) {
      first.apply({ counter: 0, deleted: false, device: 'A', key: 'item', sequence, time: sequence, value: true });
      first.apply({ counter: 0, deleted: true, device: 'A', key: 'item', sequence: sequence + 1, tags: first.observedTags('item'), time: sequence + 1, value: null });
    }
    expect(first.entries()).toEqual([]);
    expect(first.export()).toHaveLength(1);
    const restored = new DataStoreReplica('observed-remove-set');
    for (const operation of [...first.export(), ...operations]) {
      restored.apply(operation);
    }
    expect(restored.entries()).toEqual([]);
    expect(restored.export()).toEqual(first.export());
  });
});
