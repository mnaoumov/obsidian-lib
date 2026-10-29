/**
 * @file
 *
 * Contains utility functions for handling references in Obsidian.
 */

import type {
  CachedMetadata,
  FrontmatterLinkCache,
  Reference
} from 'obsidian';

import {
  isFrontmatterLinkCache,
  isReferenceCache
} from '@obsidian-typings/obsidian-public-latest/implementations';

import type { FileChange } from './file-change.ts';

import { isFrontmatterLinkCacheWithOffsets } from './frontmatter-link-cache-with-offsets.ts';
import {
  isPositionInOffsetRange,
  isPositionInsideSome
} from './position.ts';

/**
 * A reference within a file node in a canvas.
 */
export interface CanvasFileNodeReference extends CanvasReference {
  /**
   * A type of reference.
   */
  readonly type: 'file';
}

/**
 * A reference within a canvas.
 */
export interface CanvasReference extends FrontmatterLinkCache {
  /**
   * Whether the reference is a canvas reference.
   */
  readonly isCanvas: true;

  /**
   * An index of the node in the canvas.
   */
  readonly nodeIndex: number;

  /**
   * A type of reference.
   */
  readonly type: 'file' | 'text';
}

/**
 * A reference within a text node in a canvas.
 */
export interface CanvasTextNodeReference extends CanvasReference {
  /**
   * An original reference.
   */
  readonly originalReference: Reference;

  /**
   * A type of reference.
   */
  readonly type: 'text';
}

/**
 * A range within a file's content, expressed in character offsets.
 *
 * Both bounds are inclusive: a reference whose own offsets coincide exactly with
 * {@link OffsetRange.startOffset} / {@link OffsetRange.endOffset} is inside the range.
 */
export interface OffsetRange {
  /**
   * An end offset of the range within the file's content.
   */
  readonly endOffset: number;

  /**
   * A start offset of the range within the file's content.
   */
  readonly startOffset: number;
}

/**
 * Gets the text of the one link a reference stands for.
 *
 * For most references that is {@link Reference.original}. A frontmatter link that carries offsets is the
 * exception: its `original` is the WHOLE property value, which may hold several links, and `startOffset` /
 * `endOffset` give this link's span in it. Anything that parses, compares or replaces the link as one link
 * must read that span, never the whole value.
 *
 * @param reference - The reference.
 * @returns The text of the link.
 */
export function getReferenceLinkText(reference: Reference): string {
  return isFrontmatterLinkCacheWithOffsets(reference) ? reference.original.slice(reference.startOffset, reference.endOffset) : reference.original;
}

/**
 * Checks if a reference is a canvas file node reference.
 *
 * @param reference - The reference to check.
 * @returns Whether the reference is a canvas file node reference.
 */
export function isCanvasFileNodeReference(reference: Reference): reference is CanvasFileNodeReference {
  return isCanvasReference(reference) && reference.type === 'file';
}

/**
 * Checks if a reference is a canvas reference.
 *
 * @param reference - The reference to check.
 * @returns Whether the reference is a canvas reference.
 */
export function isCanvasReference(reference: Reference): reference is CanvasReference {
  return isFrontmatterLinkCache(reference) && !!(reference as Partial<CanvasReference>).isCanvas;
}

/**
 * Checks if a reference is a canvas text node reference.
 *
 * @param reference - The reference to check.
 * @returns Whether the reference is a canvas text node reference.
 */
export function isCanvasTextNodeReference(reference: Reference): reference is CanvasTextNodeReference {
  return isCanvasReference(reference) && reference.type === 'text';
}

/**
 * Checks if a reference sits inside a heading.
 *
 * The answer comes from the parsed heading positions of the file's metadata, never from a pattern over its
 * text: a reference is inside a heading when it is fully contained in a `headings` entry or in a `heading`
 * section. The section covers a Setext heading's underline as well, so both heading syntaxes count.
 *
 * Only a reference that carries a position within the file's content can be inside a heading. A
 * {@link FrontmatterLinkCache} — a frontmatter link, a multi-link frontmatter value entry, or any canvas
 * reference — never is.
 *
 * A link in a heading is part of that heading's text, and so of every `#heading` subpath pointing at it.
 * Rewriting such a link changes the heading text and breaks those subpaths, which is why a link converter
 * may want to leave it alone.
 *
 * @param reference - The reference to check.
 * @param cache - The metadata of the file the reference belongs to.
 * @returns Whether the reference is fully contained in a heading.
 */
export function isReferenceInHeading(reference: Reference, cache: CachedMetadata | null): boolean {
  if (!cache || !isReferenceCache(reference)) {
    return false;
  }

  return isPositionInsideSome(reference.position, [
    ...cache.headings ?? [],
    ...(cache.sections ?? []).filter((section) => section.type === 'heading')
  ]);
}

/**
 * Checks if a reference is fully contained within an offset range.
 *
 * Only a reference that carries a position within the file's content can be in a range. A
 * {@link FrontmatterLinkCache} — a frontmatter link, a multi-link frontmatter value entry, or any canvas
 * reference — carries no such position and is therefore never in range. Its `startOffset` / `endOffset`,
 * where present, locate the link within its own property value rather than within the file, so they are
 * deliberately not compared against the range.
 *
 * Containment is full and both bounds are inclusive: a reference that only partially overlaps the range is
 * not in it, because rewriting part of a link corrupts it.
 *
 * @param reference - The reference to check.
 * @param offsetRange - The offset range to check against.
 * @returns Whether the reference is fully contained within the offset range.
 */
export function isReferenceInOffsetRange(reference: Reference, offsetRange: OffsetRange): boolean {
  return isReferenceCache(reference) && isPositionInOffsetRange(reference.position, offsetRange);
}

/**
 * Converts a reference to a file change.
 *
 * @param reference - The reference to convert.
 * @param newContent - The new content for the reference.
 * @returns The file change.
 */
export function referenceToFileChange(reference: Reference, newContent: string): FileChange {
  return {
    newContent,
    oldContent: getReferenceLinkText(reference),
    reference
  };
}

/**
 * Sorts references by their type and position.
 *
 * @param references - The references to sort.
 * @returns The sorted references.
 */
export function sortReferences(references: Reference[]): Reference[] {
  return references.sort((a, b) => {
    if (isFrontmatterLinkCache(a) && isFrontmatterLinkCache(b)) {
      const aStartOffset = isFrontmatterLinkCacheWithOffsets(a) ? a.startOffset : 0;
      /* v8 ignore start -- v8 incorrectly reports this branch as uncovered, but it is covered by `should sort two frontmatter links without offsets` test. */
      const bStartOffset = isFrontmatterLinkCacheWithOffsets(b) ? b.startOffset : 0;
      /* v8 ignore stop */
      return a.key.localeCompare(b.key) || Number(isFrontmatterLinkCacheWithOffsets(b)) - Number(isFrontmatterLinkCacheWithOffsets(a))
        || aStartOffset - bStartOffset;
    }

    if (isReferenceCache(a) && isReferenceCache(b)) {
      return a.position.start.offset - b.position.start.offset;
    }

    return isFrontmatterLinkCache(a) ? 1 : -1;
  });
}
