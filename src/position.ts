/**
 * @file
 *
 * Contains utility functions for comparing positions within a file's content.
 */

import type { Pos } from 'obsidian';

import type { OffsetRange } from './reference.ts';

/**
 * A position, or anything that carries one.
 */
export type PositionContainer = Pos | Positioned;

/**
 * Anything that carries a position within a file's content: a reference cache, a heading, a section, a list
 * item, and so on.
 */
export interface Positioned {
  /**
   * A position within the file's content.
   */
  readonly position: Pos;
}

/**
 * Checks if a position is fully contained within an offset range.
 *
 * Containment is full and both bounds are inclusive: a position that coincides exactly with the range is
 * inside it, and one that only partially overlaps it is not.
 *
 * @param position - The position to check.
 * @param offsetRange - The offset range to check against.
 * @returns Whether the position is fully contained within the offset range.
 */
export function isPositionInOffsetRange(position: Pos, offsetRange: OffsetRange): boolean {
  return offsetRange.startOffset <= position.start.offset && position.end.offset <= offsetRange.endOffset;
}

/**
 * Checks if a position is fully contained within another position.
 *
 * Only the offsets are compared. Containment is full and both bounds are inclusive: a position equal to the
 * outer one is inside it, and one that only partially overlaps it is not.
 *
 * @param inner - The position to check.
 * @param outer - The position to check against.
 * @returns Whether the inner position is fully contained within the outer one.
 */
export function isPositionInside(inner: Pos, outer: Pos): boolean {
  return outer.start.offset <= inner.start.offset && inner.end.offset <= outer.end.offset;
}

/**
 * Checks if a position is fully contained within any of the given containers.
 *
 * Each container is a position, or anything that carries one (a reference cache, a heading, a section). The
 * containment test is {@link isPositionInside}.
 *
 * @param inner - The position to check.
 * @param containers - The positions, or things carrying positions, to check against.
 * @returns Whether the inner position is fully contained within at least one container.
 */
export function isPositionInsideAnyOf(inner: Pos, containers: readonly PositionContainer[]): boolean {
  return containers.some((container) => isPositionInside(inner, getPosition(container)));
}

function getPosition(container: PositionContainer): Pos {
  return 'position' in container ? container.position : container;
}
