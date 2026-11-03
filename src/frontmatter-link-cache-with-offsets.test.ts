import type {
  FrontmatterLinkCache,
  Reference
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FrontmatterLinkCacheWithOffsets } from './frontmatter-link-cache-with-offsets.ts';

import {
  isFrontmatterLinkCacheWithOffsets,
  toFrontmatterLinkCacheWithOffsets
} from './frontmatter-link-cache-with-offsets.ts';

function makeFrontmatterLink(original: string): FrontmatterLinkCache {
  return {
    displayText: original,
    key: 'aliases',
    link: original,
    original
  };
}

describe('isFrontmatterLinkCacheWithOffsets', () => {
  it('should return true when startOffset and endOffset are present', () => {
    const reference = strictProxy<FrontmatterLinkCacheWithOffsets>({
      ...makeFrontmatterLink('link'),
      endOffset: 4,
      startOffset: 0
    });
    expect(isFrontmatterLinkCacheWithOffsets(reference)).toBe(true);
  });

  it('should return false for a frontmatter link without offsets', () => {
    const reference = castTo<Reference>(makeFrontmatterLink('link'));
    expect(isFrontmatterLinkCacheWithOffsets(reference)).toBe(false);
  });

  it('should return false for a reference cache (no key)', () => {
    const reference = {
      link: '[[link]]',
      original: '[[link]]',
      position: { end: { col: 0, line: 0, offset: 8 }, start: { col: 0, line: 0, offset: 0 } }
    } as Reference;
    expect(isFrontmatterLinkCacheWithOffsets(reference)).toBe(false);
  });

  it('should return false when only startOffset is present', () => {
    const reference = castTo<Reference>({
      ...makeFrontmatterLink('link'),
      startOffset: 0
    });
    expect(isFrontmatterLinkCacheWithOffsets(reference)).toBe(false);
  });
});

describe('toFrontmatterLinkCacheWithOffsets', () => {
  it('should return the same reference if already has offsets', () => {
    const reference = {
      ...makeFrontmatterLink('link'),
      endOffset: 4,
      startOffset: 0
    };
    const result = toFrontmatterLinkCacheWithOffsets(castTo<FrontmatterLinkCache>(reference));
    expect(result).toBe(reference);
  });

  it('should add offsets spanning the full original string when not present', () => {
    const reference = makeFrontmatterLink('hello');
    const result = toFrontmatterLinkCacheWithOffsets(reference);
    expect(result.startOffset).toBe(0);
    expect(result.endOffset).toBe(5);
  });

  it('should preserve all original properties', () => {
    const reference = makeFrontmatterLink('link');
    const result = toFrontmatterLinkCacheWithOffsets(reference);
    expect(result.key).toBe('aliases');
    expect(result.original).toBe('link');
    expect(result.link).toBe('link');
  });
});
