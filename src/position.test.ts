import type { Pos } from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  isPositionInOffsetRange,
  isPositionInside,
  isPositionInsideSome
} from './position.ts';

function makePos(startOffset: number, endOffset: number): Pos {
  return {
    end: { col: endOffset, line: 0, offset: endOffset },
    start: { col: startOffset, line: 0, offset: startOffset }
  };
}

describe('isPositionInside', () => {
  it('should be true for a position strictly inside', () => {
    expect(isPositionInside(makePos(5, 10), makePos(0, 20))).toBe(true);
  });

  it('should be true for equal bounds', () => {
    expect(isPositionInside(makePos(5, 10), makePos(5, 10))).toBe(true);
  });

  it('should be false for a position overlapping the start', () => {
    expect(isPositionInside(makePos(0, 10), makePos(5, 20))).toBe(false);
  });

  it('should be false for a position overlapping the end', () => {
    expect(isPositionInside(makePos(15, 25), makePos(5, 20))).toBe(false);
  });

  it('should be false for a position outside', () => {
    expect(isPositionInside(makePos(30, 40), makePos(5, 20))).toBe(false);
  });

  it('should be false for a position enclosing the outer one', () => {
    expect(isPositionInside(makePos(0, 30), makePos(5, 20))).toBe(false);
  });
});

describe('isPositionInsideSome', () => {
  it('should be true when a bare position contains it', () => {
    expect(isPositionInsideSome(makePos(5, 10), [makePos(30, 40), makePos(0, 20)])).toBe(true);
  });

  it('should be true when a container carrying a position contains it', () => {
    expect(isPositionInsideSome(makePos(5, 10), [{ position: makePos(30, 40) }, { position: makePos(5, 10) }])).toBe(true);
  });

  it('should be false when only overlapping or outside containers are given', () => {
    expect(isPositionInsideSome(makePos(5, 10), [makePos(0, 7), { position: makePos(8, 20) }, makePos(30, 40)])).toBe(false);
  });

  it('should be false for no containers', () => {
    expect(isPositionInsideSome(makePos(5, 10), [])).toBe(false);
  });
});

describe('isPositionInOffsetRange', () => {
  it('should be true for a position strictly inside', () => {
    expect(isPositionInOffsetRange(makePos(5, 10), { endOffset: 20, startOffset: 0 })).toBe(true);
  });

  it('should be true for equal bounds', () => {
    expect(isPositionInOffsetRange(makePos(5, 10), { endOffset: 10, startOffset: 5 })).toBe(true);
  });

  it('should be false for a position overlapping the range', () => {
    expect(isPositionInOffsetRange(makePos(0, 10), { endOffset: 20, startOffset: 5 })).toBe(false);
    expect(isPositionInOffsetRange(makePos(15, 25), { endOffset: 20, startOffset: 5 })).toBe(false);
  });

  it('should be false for a position outside', () => {
    expect(isPositionInOffsetRange(makePos(30, 40), { endOffset: 20, startOffset: 5 })).toBe(false);
  });
});
