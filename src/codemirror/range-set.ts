/**
 * @file
 *
 * Helpers for CodeMirror {@link RangeSet}s.
 */

import type {
  RangeSet,
  RangeValue
} from '@codemirror/state';

/**
 * One range of a {@link RangeSet}, as plain data.
 *
 * @typeParam Value - The type of the range value.
 */
export interface RangeSetEntry<Value extends RangeValue> {
  /**
   * The start of the range.
   */
  readonly from: number;

  /**
   * The end of the range.
   */
  readonly to: number;

  /**
   * The value of the range.
   */
  readonly value: Value;
}

/**
 * Lists the ranges of a {@link RangeSet} in document order, for assertions in tests and for debugging.
 *
 * @typeParam Value - The type of the range values.
 * @param rangeSet - The range set to list, e.g. a `DecorationSet`.
 * @param from - The position to start listing from. Ranges ending before it are skipped. Defaults to `0`.
 * @returns The ranges as plain `{ from, to, value }` objects.
 */
export function rangeSetToArray<Value extends RangeValue>(rangeSet: RangeSet<Value>, from = 0): RangeSetEntry<Value>[] {
  const entries: RangeSetEntry<Value>[] = [];
  const cursor = rangeSet.iter(from);
  while (cursor.value !== null) {
    entries.push({ from: cursor.from, to: cursor.to, value: cursor.value });
    cursor.next();
  }
  return entries;
}
