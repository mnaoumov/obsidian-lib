import type { ReferenceLinkCache } from 'obsidian';

import { isReferenceCache } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FileChange } from './file-change.ts';

import { referenceDefinitionToFileChange } from './reference-definition.ts';

interface DefinitionParams {
  readonly content: string;
  readonly definitionText: string;
  readonly link: string;
}

function apply(content: string, fileChange: FileChange | null): null | string {
  if (fileChange === null) {
    return null;
  }

  const { reference } = fileChange;
  if (!isReferenceCache(reference)) {
    throw new Error('Expected a reference with a position');
  }
  const { position } = reference;
  expect(content.slice(position.start.offset, position.end.offset)).toBe(fileChange.oldContent);
  return content.slice(0, position.start.offset) + fileChange.newContent + content.slice(position.end.offset);
}

function createDefinition(params: DefinitionParams): ReferenceLinkCache {
  const { content, definitionText, link } = params;
  const start = content.indexOf(definitionText);
  const end = start + definitionText.length;
  return {
    id: 'id',
    link,
    position: {
      end: { col: 0, line: 0, offset: end },
      start: { col: 0, line: content.slice(0, start).split('\n').length - 1, offset: start }
    }
  };
}

function edit(definitionText: string, link: string, newDestination: string, content = definitionText): null | string {
  const definition = createDefinition({ content, definitionText, link });
  return apply(content, referenceDefinitionToFileChange({ content, definition, newDestination }));
}

describe('referenceDefinitionToFileChange', () => {
  it('should replace a bare destination and keep the id and the title', () => {
    expect(edit('[a]: Target.md#Old "Title"', 'Target.md#Old', 'Target.md#New')).toBe('[a]: Target.md#New "Title"');
    expect(edit('[a]: Target.md#Old', 'Target.md#Old', 'Other.md')).toBe('[a]: Other.md');
  });

  it('should keep angle brackets', () => {
    expect(edit('[b]: <Target Note.md#Old> \'T\'', 'Target Note.md#Old', 'Other.md')).toBe('[b]: <Other.md> \'T\'');
  });

  it('should edit a destination on the line after the label, keeping line endings, indentation and the title', () => {
    expect(edit('[c]:\r\n  Target#Old\r\n  (Title)', 'Target#Old', 'Target#New')).toBe('[c]:\r\n  Target#New\r\n  (Title)');
  });

  it('should edit a definition continued inside a blockquote', () => {
    const content = '> [f]:\n>   Quoted.md';
    expect(edit('[f]:\n>   Quoted.md', 'Quoted.md', 'New.md', content)).toBe('> [f]:\n>   New.md');
  });

  it('should report the destination position with its line and column', () => {
    const content = 'Use [a].\n\n   [a]:\n  Target.md';
    const definition = createDefinition({ content, definitionText: '   [a]:\n  Target.md', link: 'Target.md' });
    const fileChange = referenceDefinitionToFileChange({ content, definition, newDestination: 'Other.md' });
    expect(fileChange?.reference).toEqual({
      link: 'Target.md',
      original: 'Target.md',
      position: {
        end: { col: 11, line: 3, offset: content.length },
        start: { col: 2, line: 3, offset: content.length - 'Target.md'.length }
      }
    });
    expect(apply(content, fileChange)).toBe('Use [a].\n\n   [a]:\n  Other.md');
  });

  it('should match a destination whose metadata link has its escapes resolved', () => {
    expect(edit(String.raw`[e]: Target\#Escaped.md`, 'Target#Escaped.md', 'Other.md')).toBe('[e]: Other.md');
    expect(edit(String.raw`[e]: <A\>B.md>`, 'A>B.md', 'C.md')).toBe('[e]: <C.md>');
    expect(edit(String.raw`[esc\]aped]: x`, 'x', 'y')).toBe(String.raw`[esc\]aped]: y`);
  });

  it('should keep a backslash that escapes nothing, and end a bare destination at a space after it', () => {
    expect(edit(String.raw`[e]: A\b.md`, String.raw`A\b.md`, 'C.md')).toBe('[e]: C.md');
    expect(edit(String.raw`[e]: A\ b.md`, String.raw`A\ b.md`, 'C.md')).toBeNull();
  });

  it('should escape a backslash that would otherwise escape the next character', () => {
    expect(edit('[a]: x', 'x', String.raw`A\#B`)).toBe(String.raw`[a]: A\\#B`);
    expect(edit('[a]: x', 'x', String.raw`A\b\ `)).toBe(String.raw`[a]: <A\b\ >`);
    expect(edit('[a]: <x>', 'x', String.raw`A\!\b\ `)).toBe(String.raw`[a]: <A\\!\b\ >`);
    expect(edit('[a]: <x>', 'x', 'a<b>c\\')).toBe(String.raw`[a]: <a\<b\>c\\>`);
  });

  it('should switch a bare destination to angle brackets only when it cannot stay bare', () => {
    expect(edit('[a]: x', 'x', 'New Note.md')).toBe('[a]: <New Note.md>');
    expect(edit('[a]: x', 'x', '<x')).toBe(String.raw`[a]: <\<x>`);
    expect(edit('[a]: x', 'x', '')).toBe('[a]: <>');
    expect(edit('[a]: x', 'x', 'a\tb')).toBe('[a]: <a\tb>');
    expect(edit('[a]: x', 'x', 'a)b(')).toBe('[a]: <a)b(>');
    expect(edit('[a]: x', 'x', 'a(b')).toBe('[a]: <a(b>');
    expect(edit('[a]: x', 'x', 'a(b)c(d)')).toBe('[a]: a(b)c(d)');
  });

  it('should refuse a new destination holding a line break', () => {
    expect(edit('[a]: x', 'x', 'a\nb')).toBeNull();
    expect(edit('[a]: x', 'x', 'a\rb')).toBeNull();
  });

  it('should refuse content that no longer holds the definition the metadata describes', () => {
    for (const text of ['[label](Target#Old)', '[label]: Other#Old "Target#Old"', '[label]: Target#OldSuffix', '[label]: <Target#OldSuffix>']) {
      expect(edit(text, 'Target#Old', 'Target#New')).toBeNull();
    }
    expect(edit('[a]: <Target#Old', 'Target#Old', 'New')).toBeNull();
    expect(edit('[a]: <Target#Old>x', 'Target#Old', 'New')).toBeNull();
    expect(edit('[a]: <Target\n#Old>', 'Target\n#Old', 'New')).toBeNull();
    expect(edit('[a]:', '', 'New')).toBeNull();
  });

  it('should refuse a position outside the content', () => {
    const content = '[a]: x';
    const valid = createDefinition({ content, definitionText: content, link: 'x' });
    for (const [start, end] of [[-1, content.length], [0, content.length + 1], [content.length, 0]] as const) {
      const definition: ReferenceLinkCache = {
        ...valid,
        position: { end: { col: 0, line: 0, offset: end }, start: { col: 0, line: 0, offset: start } }
      };
      expect(referenceDefinitionToFileChange({ content, definition, newDestination: 'y' })).toBeNull();
    }
  });
});
