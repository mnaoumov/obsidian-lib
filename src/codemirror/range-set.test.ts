/**
 * @file
 *
 * Tests for {@link rangeSetToArray}.
 */

import {
  RangeSet,
  RangeValue
} from '@codemirror/state';
import {
  describe,
  expect,
  it
} from 'vitest';

import { rangeSetToArray } from './range-set.ts';

class LabelValue extends RangeValue {
  public constructor(public readonly label: string) {
    super();
  }
}

describe('rangeSetToArray', () => {
  const a = new LabelValue('a');
  const b = new LabelValue('b');
  const c = new LabelValue('c');
  const rangeSet = RangeSet.of([b.range(5, 8), a.range(0, 2), c.range(10, 10)], true);

  it('should list every range in document order', () => {
    expect(rangeSetToArray(rangeSet)).toEqual([
      { from: 0, to: 2, value: a },
      { from: 5, to: 8, value: b },
      { from: 10, to: 10, value: c }
    ]);
  });

  it('should skip ranges ending before the start position', () => {
    expect(rangeSetToArray(rangeSet, 3)).toEqual([
      { from: 5, to: 8, value: b },
      { from: 10, to: 10, value: c }
    ]);
  });

  it('should return an empty array for an empty set', () => {
    expect(rangeSetToArray(RangeSet.empty)).toEqual([]);
  });
});
