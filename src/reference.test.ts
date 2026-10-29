import type {
  CachedMetadata,
  FrontmatterLinkCache,
  Pos,
  Reference,
  SectionCache
} from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FrontmatterLinkCacheWithOffsets } from './frontmatter-link-cache-with-offsets.ts';
import type { CanvasReference } from './reference.ts';

import {
  getReferenceLinkText,
  isCanvasFileNodeReference,
  isCanvasReference,
  isCanvasTextNodeReference,
  isReferenceInHeading,
  isReferenceInOffsetRange,
  referenceToFileChange,
  sortReferences
} from './reference.ts';

interface CanvasReferenceEx extends CanvasReference {
  readonly position?: undefined;
}

interface FrontmatterLinkCacheEx extends FrontmatterLinkCache {
  readonly endOffset?: undefined;
  readonly isCanvas?: undefined;
  readonly position?: undefined;
  readonly startOffset?: undefined;
}

interface FrontmatterLinkCacheWithOffsetsEx extends FrontmatterLinkCacheWithOffsets {
  readonly position?: undefined;
}

function makeCanvasReference(type: 'file' | 'text', key: string): Reference {
  return strictProxy<CanvasReferenceEx>({
    displayText: 'link',
    isCanvas: true,
    key,
    link: 'link',
    nodeIndex: 0,
    original: 'link',
    position: undefined,
    type
  });
}

function makeFrontmatterLink(original: string, key: string): Reference {
  return strictProxy<FrontmatterLinkCacheEx>({
    displayText: original,
    endOffset: undefined,
    isCanvas: undefined,
    key,
    link: original,
    original,
    position: undefined,
    startOffset: undefined
  });
}

function makeFrontmatterLinkWithOffsets(original: string, key: string, startOffset: number, endOffset: number): Reference {
  return strictProxy<FrontmatterLinkCacheWithOffsetsEx>({
    displayText: original,
    endOffset,
    key,
    link: original,
    original,
    position: undefined,
    startOffset
  });
}

function makeReferenceCache(original: string, startOffset: number): Reference {
  return {
    link: original,
    original,
    position: {
      end: { col: 0, line: 0, offset: startOffset + original.length },
      start: { col: 0, line: 0, offset: startOffset }
    }
  } as Reference;
}

describe('isCanvasReference', () => {
  it('should return true for a canvas reference', () => {
    const reference = makeCanvasReference('file', 'k');
    expect(isCanvasReference(reference)).toBe(true);
  });

  it('should return false for a regular reference cache', () => {
    const reference = makeReferenceCache('[[link]]', 0);
    expect(isCanvasReference(reference)).toBe(false);
  });

  it('should return false for a frontmatter link without isCanvas', () => {
    const reference = makeFrontmatterLink('link', 'aliases');
    expect(isCanvasReference(reference)).toBe(false);
  });
});

describe('isCanvasFileNodeReference', () => {
  it('should return true for a canvas file node reference', () => {
    const reference = makeCanvasReference('file', 'k');
    expect(isCanvasFileNodeReference(reference)).toBe(true);
  });

  it('should return false for a canvas text node reference', () => {
    const reference = makeCanvasReference('text', 'k');
    expect(isCanvasFileNodeReference(reference)).toBe(false);
  });

  it('should return false for a regular reference', () => {
    const reference = makeReferenceCache('[[link]]', 0);
    expect(isCanvasFileNodeReference(reference)).toBe(false);
  });
});

describe('isCanvasTextNodeReference', () => {
  it('should return true for a canvas text node reference', () => {
    const reference = makeCanvasReference('text', 'k');
    expect(isCanvasTextNodeReference(reference)).toBe(true);
  });

  it('should return false for a canvas file node reference', () => {
    const reference = makeCanvasReference('file', 'k');
    expect(isCanvasTextNodeReference(reference)).toBe(false);
  });

  it('should return false for a regular reference', () => {
    const reference = makeReferenceCache('[[link]]', 0);
    expect(isCanvasTextNodeReference(reference)).toBe(false);
  });
});

describe('isReferenceInHeading', () => {
  function makePosition(startOffset: number, endOffset: number): Pos {
    return {
      end: { col: 0, line: 0, offset: endOffset },
      start: { col: 0, line: 0, offset: startOffset }
    };
  }

  function makeCache(headingPositions: Pos[], sections: SectionCache[] = []): CachedMetadata {
    return {
      headings: headingPositions.map((position) => ({ heading: 'heading', level: 1, position })),
      sections
    };
  }

  it('should return true for a reference inside a headings entry', () => {
    const reference = makeReferenceCache('[[link]]', 3);
    expect(isReferenceInHeading(reference, makeCache([makePosition(0, 20)]))).toBe(true);
  });

  it('should return true for a reference whose bounds coincide with the heading', () => {
    const reference = makeReferenceCache('[[link]]', 3);
    expect(isReferenceInHeading(reference, makeCache([makePosition(3, 11)]))).toBe(true);
  });

  it('should return true for a reference inside a heading section, as a Setext heading is', () => {
    const reference = makeReferenceCache('[[link]]', 0);
    expect(isReferenceInHeading(reference, makeCache([], [{ position: makePosition(0, 12), type: 'heading' }]))).toBe(true);
  });

  it('should return false for a reference inside a section of another type', () => {
    const reference = makeReferenceCache('[[link]]', 0);
    expect(isReferenceInHeading(reference, makeCache([], [{ position: makePosition(0, 12), type: 'paragraph' }]))).toBe(false);
  });

  it('should return false for a reference straddling the end of a heading', () => {
    const reference = makeReferenceCache('[[link]]', 3);
    expect(isReferenceInHeading(reference, makeCache([makePosition(0, 10)]))).toBe(false);
  });

  it('should return false for a reference after every heading', () => {
    const reference = makeReferenceCache('[[link]]', 30);
    expect(isReferenceInHeading(reference, makeCache([makePosition(0, 10)]))).toBe(false);
  });

  it('should return false for a cache with neither headings nor sections', () => {
    const reference = makeReferenceCache('[[link]]', 3);
    expect(isReferenceInHeading(reference, {})).toBe(false);
  });

  it('should return false for a missing cache', () => {
    const reference = makeReferenceCache('[[link]]', 3);
    expect(isReferenceInHeading(reference, null)).toBe(false);
  });

  it('should return false for a frontmatter link, which carries no file position', () => {
    const reference = makeFrontmatterLink('link', 'aliases');
    expect(isReferenceInHeading(reference, makeCache([makePosition(0, 1000)]))).toBe(false);
  });
});

describe('isReferenceInOffsetRange', () => {
  it('should return true for a reference fully contained in the range', () => {
    const reference = makeReferenceCache('[[link]]', 10);
    expect(isReferenceInOffsetRange(reference, { endOffset: 30, startOffset: 5 })).toBe(true);
  });

  it('should return true for a reference whose bounds coincide with the range', () => {
    const reference = makeReferenceCache('[[link]]', 10);
    expect(isReferenceInOffsetRange(reference, { endOffset: 18, startOffset: 10 })).toBe(true);
  });

  it('should return false for a reference straddling the range start', () => {
    const reference = makeReferenceCache('[[link]]', 10);
    expect(isReferenceInOffsetRange(reference, { endOffset: 30, startOffset: 11 })).toBe(false);
  });

  it('should return false for a reference straddling the range end', () => {
    const reference = makeReferenceCache('[[link]]', 10);
    expect(isReferenceInOffsetRange(reference, { endOffset: 17, startOffset: 5 })).toBe(false);
  });

  it('should return false for a reference entirely before the range', () => {
    const reference = makeReferenceCache('[[link]]', 0);
    expect(isReferenceInOffsetRange(reference, { endOffset: 30, startOffset: 20 })).toBe(false);
  });

  it('should return false for a reference entirely after the range', () => {
    const reference = makeReferenceCache('[[link]]', 40);
    expect(isReferenceInOffsetRange(reference, { endOffset: 30, startOffset: 20 })).toBe(false);
  });

  it('should return false for every reference when the range is empty', () => {
    const reference = makeReferenceCache('[[link]]', 10);
    expect(isReferenceInOffsetRange(reference, { endOffset: 10, startOffset: 10 })).toBe(false);
  });

  it('should return false for a frontmatter link, which carries no file position', () => {
    const reference = makeFrontmatterLink('link', 'aliases');
    expect(isReferenceInOffsetRange(reference, { endOffset: 1000, startOffset: 0 })).toBe(false);
  });

  it('should return false for a frontmatter link whose value-relative offsets fall inside the range', () => {
    const reference = makeFrontmatterLinkWithOffsets('hello world', 'aliases', 6, 11);
    expect(isReferenceInOffsetRange(reference, { endOffset: 20, startOffset: 0 })).toBe(false);
  });

  it('should return false for a canvas reference', () => {
    const reference = makeCanvasReference('file', 'k');
    expect(isReferenceInOffsetRange(reference, { endOffset: 1000, startOffset: 0 })).toBe(false);
  });
});

describe('getReferenceLinkText', () => {
  it('should return the original of a regular reference cache', () => {
    expect(getReferenceLinkText(makeReferenceCache('[[link]]', 10))).toBe('[[link]]');
  });

  it('should return the original of a frontmatter link without offsets', () => {
    expect(getReferenceLinkText(makeFrontmatterLink('link', 'aliases'))).toBe('link');
  });

  it('should return the span of each link in a multi-link frontmatter value', () => {
    const value = '[[a]] and [B](<b.md>)';
    expect(getReferenceLinkText(makeFrontmatterLinkWithOffsets(value, 'related', 0, 5))).toBe('[[a]]');
    expect(getReferenceLinkText(makeFrontmatterLinkWithOffsets(value, 'related', 10, value.length))).toBe('[B](<b.md>)');
  });
});

describe('referenceToFileChange', () => {
  it('should use full original for a regular reference cache', () => {
    const reference = makeReferenceCache('[[link]]', 10);
    const change = referenceToFileChange(reference, '[[new]]');
    expect(change.oldContent).toBe('[[link]]');
    expect(change.newContent).toBe('[[new]]');
    expect(change.reference).toBe(reference);
  });

  it('should use full original for a frontmatter link without offsets', () => {
    const reference = makeFrontmatterLink('link', 'aliases');
    const change = referenceToFileChange(reference, 'new');
    expect(change.oldContent).toBe('link');
    expect(change.newContent).toBe('new');
  });

  it('should slice original using offsets for frontmatter link with offsets', () => {
    const reference = makeFrontmatterLinkWithOffsets('hello world', 'aliases', 6, 11);
    const change = referenceToFileChange(reference, 'replaced');
    expect(change.oldContent).toBe('world');
    expect(change.newContent).toBe('replaced');
  });
});

describe('sortReferences', () => {
  it('should sort reference caches by position offset', () => {
    const reference1 = makeReferenceCache('[[a]]', 50);
    const reference2 = makeReferenceCache('[[b]]', 10);
    const reference3 = makeReferenceCache('[[c]]', 30);
    const sorted = sortReferences([reference1, reference2, reference3]);
    expect(sorted).toEqual([reference2, reference3, reference1]);
  });

  it('should sort frontmatter links by key', () => {
    const reference1 = makeFrontmatterLink('link1', 'beta');
    const reference2 = makeFrontmatterLink('link2', 'alpha');
    const sorted = sortReferences([reference1, reference2]);
    expect(sorted).toEqual([reference2, reference1]);
  });

  it('should place frontmatter links after reference caches', () => {
    const referenceCache = makeReferenceCache('[[link]]', 0);
    const fmReference = makeFrontmatterLink('link', 'aliases');
    const sorted = sortReferences([fmReference, referenceCache]);
    expect(sorted).toEqual([referenceCache, fmReference]);
  });

  it('should sort frontmatter links with offsets before those without for same key', () => {
    const withOffsets = makeFrontmatterLinkWithOffsets('link', 'aliases', 0, 4);
    const withoutOffsets = makeFrontmatterLink('link', 'aliases');
    const sorted = sortReferences([withoutOffsets, withOffsets]);
    expect(sorted).toEqual([withOffsets, withoutOffsets]);
  });

  it('should sort two frontmatter links without offsets by key only', () => {
    const fm1 = makeFrontmatterLink('link1', 'aliases');
    const fm2 = makeFrontmatterLink('link2', 'aliases');
    const sorted = sortReferences([fm1, fm2]);
    expect(sorted[0]).toBe(fm1);
    expect(sorted[1]).toBe(fm2);
  });

  it('should handle empty array', () => {
    expect(sortReferences([])).toEqual([]);
  });

  it('should handle mixed reference types', () => {
    const reference1 = makeReferenceCache('[[a]]', 100);
    const reference2 = makeReferenceCache('[[b]]', 50);
    const fm1 = makeFrontmatterLink('link1', 'z');
    const fm2 = makeFrontmatterLink('link2', 'a');
    const sorted = sortReferences([fm1, reference1, fm2, reference2]);
    expect(sorted[0]).toBe(reference2);
    expect(sorted[1]).toBe(reference1);
    expect(sorted[2]).toBe(fm2);
    expect(sorted[3]).toBe(fm1);
  });
});
